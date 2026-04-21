import createClient from "openapi-fetch";
import type { paths } from "./schema";
import { ApiError, type ApiErrorEnvelope } from "./errors";
import { getAccessToken, clearTokens } from "@/lib/auth/storage";
import { refreshTokens } from "@/lib/auth/refresh-queue";

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "";

async function parseErrorEnvelope(res: Response): Promise<ApiErrorEnvelope> {
  const envelope: ApiErrorEnvelope = {
    code: `http_${res.status}`,
    message: res.statusText || "Request failed",
    field: null,
    hint: null,
  };
  try {
    const body = (await res.clone().json()) as Record<string, unknown>;
    if (body?.error && typeof body.error === "object") {
      return body.error as ApiErrorEnvelope;
    }
  } catch {
    /* non-JSON error bodies — keep default envelope */
  }
  return envelope;
}

export const api = createClient<paths>({
  baseUrl,
  fetch: async (input, init) => {
    const headers = new Headers(init?.headers);
    const token = getAccessToken();
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    if (!headers.has("Accept")) headers.set("Accept", "application/json");

    const res = await fetch(input, { ...init, headers });

    if (res.status === 401) {
      // Attempt token refresh then retry once
      try {
        const newToken = await refreshTokens();
        const retryHeaders = new Headers(init?.headers);
        retryHeaders.set("Authorization", `Bearer ${newToken}`);
        retryHeaders.set("Accept", "application/json");
        const retryRes = await fetch(input, { ...init, headers: retryHeaders });
        if (!retryRes.ok) {
          throw new ApiError(retryRes.status, await parseErrorEnvelope(retryRes));
        }
        return retryRes;
      } catch (refreshErr) {
        // If refresh failed, clearTokens was already called in refreshTokens()
        // Re-throw as ApiError(401) if it isn't one already
        if (refreshErr instanceof ApiError) throw refreshErr;
        clearTokens();
        throw new ApiError(401, {
          code: "unauthorized",
          message: "Session expired. Please log in again.",
          field: null,
          hint: null,
        });
      }
    }

    if (!res.ok) {
      throw new ApiError(res.status, await parseErrorEnvelope(res));
    }

    return res;
  },
});
