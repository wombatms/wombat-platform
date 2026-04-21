export interface ApiErrorEnvelope {
  code: string;
  message: string;
  field: string | null;
  hint: string | null;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly field: string | null;
  readonly hint: string | null;

  constructor(status: number, env: ApiErrorEnvelope) {
    super(env.message);
    this.status = status;
    this.code = env.code;
    this.field = env.field;
    this.hint = env.hint;
    this.name = "ApiError";
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}
