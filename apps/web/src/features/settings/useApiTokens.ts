import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { keys } from "@/lib/query/keys";

export interface ApiToken {
  id: string;
  name: string;
  scopes: string[];
  expires_at: string | null;
  created_at: string;
}

export interface CreateTokenRequest {
  name: string;
  scopes: string[];
  expires_in_days?: number | null;
}

export interface CreateTokenResponse extends ApiToken {
  raw_token: string;
}

export function useApiTokens() {
  return useQuery({
    queryKey: keys.tokens,
    queryFn: async (): Promise<ApiToken[]> => {
      const { data, error } = await api.GET("/api/auth/api-tokens");
      if (error) throw error;
      return data as ApiToken[];
    },
  });
}

export function useCreateToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (req: CreateTokenRequest): Promise<CreateTokenResponse> => {
      const { data, error } = await api.POST("/api/auth/api-tokens", {
        body: req,
      });
      if (error) throw error;
      return data as CreateTokenResponse;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.tokens });
    },
  });
}

export function useRevokeToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tokenId: string): Promise<void> => {
      const { error } = await api.DELETE("/api/auth/api-tokens/{token_id}", {
        params: { path: { token_id: tokenId } },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.tokens });
    },
  });
}
