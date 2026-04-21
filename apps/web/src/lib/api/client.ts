import createClient, { type Middleware } from "openapi-fetch";
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

const authMiddleware: Middleware = {
  async onRequest({ request }) {
    const token = getAccessToken();
    if (token && !request.headers.has("Authorization")) {
      request.headers.set("Authorization", `Bearer ${token}`);
    }
    if (!request.headers.has("Accept")) {
      request.headers.set("Accept", "application/json");
    }
    return request;
  },

  async onResponse({ response, request }) {
    if (response.status === 401) {
      // Attempt token refresh then retry once
      try {
        const newToken = await refreshTokens();
        const retryRequest = new Request(request, {
          headers: (() => {
            const h = new Headers(request.headers);
            h.set("Authorization", `Bearer ${newToken}`);
            return h;
          })(),
        });
        const retryRes = await fetch(retryRequest);
        if (!retryRes.ok) {
          throw new ApiError(retryRes.status, await parseErrorEnvelope(retryRes));
        }
        return retryRes;
      } catch (refreshErr) {
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

    if (!response.ok) {
      throw new ApiError(response.status, await parseErrorEnvelope(response));
    }

    return response;
  },
};

export const api = createClient<paths>({ baseUrl });
api.use(authMiddleware);
