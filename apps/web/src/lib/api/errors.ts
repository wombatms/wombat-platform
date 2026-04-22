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

// ---------------------------------------------------------------------------
// SP3.3 specialised run-tier error classes
//
// Each subclass wraps a raw ApiError so the original status/field/hint are
// preserved. Extra fields are extracted from the JSON-stringified `hint`
// that `parseErrorEnvelope` in client.ts writes for FastAPI structured 409s.
// ---------------------------------------------------------------------------

/**
 * Parse the `hint` field that client.ts encodes as `JSON.stringify(detail)`.
 */
function parseHint(hint: string | null): Record<string, unknown> {
  if (!hint) return {};
  try {
    const parsed = JSON.parse(hint) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // non-JSON hint — ignore
  }
  return {};
}

/** Thrown when a mutating operation targets a Run that is already closed. */
export class RunClosedError extends ApiError {
  constructor(originalError: ApiError) {
    super(originalError.status, {
      code: originalError.code,
      message: originalError.message,
      field: originalError.field,
      hint: originalError.hint,
    });
    this.name = "RunClosedError";
  }
}

/**
 * Thrown when an operation requires the Run to be in `open` state (e.g. a
 * reopen call on a run that was never closed, or a record on a run in
 * `pending` state).
 */
export class RunNotOpenError extends ApiError {
  constructor(originalError: ApiError) {
    super(originalError.status, {
      code: originalError.code,
      message: originalError.message,
      field: originalError.field,
      hint: originalError.hint,
    });
    this.name = "RunNotOpenError";
  }
}

/**
 * Thrown on 409 `result_conflict` — a concurrent writer changed the result
 * revision between the caller's read and write.
 *
 * `currentRevision` is the server's latest revision number so the Runner UI
 * can offer an overwrite-with-new-revision banner.
 */
export class ResultConflictError extends ApiError {
  readonly currentRevision: number;

  constructor(currentRevision: number, originalError: ApiError) {
    super(originalError.status, {
      code: originalError.code,
      message: originalError.message,
      field: originalError.field,
      hint: originalError.hint,
    });
    this.currentRevision = currentRevision;
    this.name = "ResultConflictError";
  }
}

/**
 * Thrown when the caller does not have permission to perform the requested
 * action on a Run (e.g. closing a run they do not own/assign).
 */
export class UnauthorizedRunActionError extends ApiError {
  constructor(originalError: ApiError) {
    super(originalError.status, {
      code: originalError.code,
      message: originalError.message,
      field: originalError.field,
      hint: originalError.hint,
    });
    this.name = "UnauthorizedRunActionError";
  }
}

/**
 * Thrown when an evidence upload exceeds the configured size limit.
 */
export class EvidenceTooLargeError extends ApiError {
  constructor(originalError: ApiError) {
    super(originalError.status, {
      code: originalError.code,
      message: originalError.message,
      field: originalError.field,
      hint: originalError.hint,
    });
    this.name = "EvidenceTooLargeError";
  }
}

/**
 * Thrown when `run_cases` references a case ID that is not part of the run.
 */
export class CaseNotInRunError extends ApiError {
  constructor(originalError: ApiError) {
    super(originalError.status, {
      code: originalError.code,
      message: originalError.message,
      field: originalError.field,
      hint: originalError.hint,
    });
    this.name = "CaseNotInRunError";
  }
}

/**
 * Thrown when attempting to add a case that already exists in the run.
 */
export class CaseAlreadyInRunError extends ApiError {
  constructor(originalError: ApiError) {
    super(originalError.status, {
      code: originalError.code,
      message: originalError.message,
      field: originalError.field,
      hint: originalError.hint,
    });
    this.name = "CaseAlreadyInRunError";
  }
}

/**
 * Thrown when the requested environment slug does not exist in the project.
 */
export class EnvironmentNotFoundError extends ApiError {
  constructor(originalError: ApiError) {
    super(originalError.status, {
      code: originalError.code,
      message: originalError.message,
      field: originalError.field,
      hint: originalError.hint,
    });
    this.name = "EnvironmentNotFoundError";
  }
}

// ---------------------------------------------------------------------------
// mapRunError — maps a raw ApiError thrown by the client into one of the
// specialised SP3.3 subclasses based on error.code. Non-run errors are
// re-thrown unchanged so callers can compose with mapProposalError.
// ---------------------------------------------------------------------------

const RUN_CODE_MAP: Record<string, (err: ApiError, detail: Record<string, unknown>) => ApiError> = {
  run_closed: (err) => new RunClosedError(err),
  run_not_open: (err) => new RunNotOpenError(err),
  result_conflict: (err, detail) => {
    const rev = typeof detail["current_revision"] === "number"
      ? detail["current_revision"]
      : 0;
    return new ResultConflictError(rev, err);
  },
  unauthorized_run_action: (err) => new UnauthorizedRunActionError(err),
  evidence_too_large: (err) => new EvidenceTooLargeError(err),
  case_not_in_run: (err) => new CaseNotInRunError(err),
  case_already_in_run: (err) => new CaseAlreadyInRunError(err),
  environment_not_found: (err) => new EnvironmentNotFoundError(err),
};

/**
 * Maps a raw error thrown by the API client into a specialised SP3.3 run
 * error where applicable. Non-run errors are re-thrown unchanged.
 *
 * Usage (inside a mutation `onError` or `throwOnError` wrapper):
 *
 * ```ts
 * try { await api.POST(...) } catch (e) { mapRunError(e) }
 * ```
 */
export function mapRunError(err: unknown): never {
  if (err instanceof ApiError) {
    const factory = RUN_CODE_MAP[err.code];
    if (factory) {
      const detail = parseHint(err.hint);
      throw factory(err, detail);
    }
  }
  throw err;
}
