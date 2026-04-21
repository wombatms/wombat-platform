import createClient from "openapi-fetch";
import type { paths } from "./schema";
import { ApiError, type ApiErrorEnvelope } from "./errors";
import { getAccessToken } from "@/lib/auth/storage";

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "";

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
    if (!res.ok) {
      let envelope: ApiErrorEnvelope = {
        code: `http_${res.status}`,
        message: res.statusText || "Request failed",
        field: null,
        hint: null,
      };
      try {
        const body = (await res.clone().json()) as Record<string, unknown>;
        if (body?.error && typeof body.error === "object") {
          envelope = body.error as ApiErrorEnvelope;
        }
      } catch {
        /* non-JSON error bodies — keep default envelope */
      }
      throw new ApiError(res.status, envelope);
    }
    return res;
  },
});
