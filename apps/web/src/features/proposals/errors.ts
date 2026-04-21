import { ApiError } from "@/lib/api/errors";

/**
 * Thrown when the proposal's base_revision is stale relative to the current
 * HEAD of the content. The caller receives the current SHA so it can surface
 * the rebase workspace.
 */
export class ConflictError extends ApiError {
  readonly currentSha: string;

  constructor(currentSha: string, originalError: ApiError) {
    super(originalError.status, {
      code: originalError.code,
      message: originalError.message,
      field: originalError.field,
      hint: originalError.hint,
    });
    this.currentSha = currentSha;
    this.name = "ConflictError";
  }
}

/**
 * Thrown when an open proposal already exists for the target content. The
 * caller receives the existing proposal's ID so the form can link to it.
 */
export class OpenProposalExistsError extends ApiError {
  readonly existingProposalId: string;

  constructor(existingProposalId: string, originalError: ApiError) {
    super(originalError.status, {
      code: originalError.code,
      message: originalError.message,
      field: originalError.field,
      hint: originalError.hint,
    });
    this.existingProposalId = existingProposalId;
    this.name = "OpenProposalExistsError";
  }
}

/**
 * Maps a raw error thrown by the API client into a specialized proposal error
 * where applicable. Non-proposal errors are re-thrown unchanged.
 *
 * Backend 409 shapes:
 *   stale_base_revision  → { code, current_sha }
 *   open_proposal_exists → { code, message, existing_proposal_id }
 *
 * The ApiError carries `code` on itself; the additional fields come from
 * the hint or need to be extracted from the original response body. Because
 * our client middleware throws ApiError before we can inspect the full body,
 * we rely on the `hint` field — but the backend puts the extra data directly
 * in the detail object.  The client's `parseErrorEnvelope` reads `body.error`
 * which matches the standard envelope; for 409s the backend uses a plain
 * `detail` dict, so the code becomes the fallback `http_409`. We therefore
 * also accept structured envelopes that the caller can pass after reading
 * the body themselves.
 *
 * In practice the backend returns:
 *   { detail: { code: "stale_base_revision", current_sha: "abc" } }
 *   { detail: { code: "open_proposal_exists", ..., existing_proposal_id: "uuid" } }
 *
 * The client's parseErrorEnvelope tries body.error first, then falls back to
 * http_409. To surface the extra fields we check error.hint (which may carry
 * a JSON-stringified payload) OR we accept a raw detail object via the
 * overloaded signature used internally by hooks.
 */
/**
 * Parse the hint field that the API client encodes as JSON.stringify(detail)
 * for FastAPI HTTPException responses with a structured detail object.
 */
function parseHint(hint: string | null): Record<string, unknown> {
  if (!hint) return {};
  try {
    const parsed = JSON.parse(hint) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // not valid JSON — ignore
  }
  return {};
}

export function mapProposalError(err: unknown): never {
  if (err instanceof ApiError) {
    const code = err.code;
    const detail = parseHint(err.hint);

    if (code === "stale_base_revision") {
      const sha = (detail["current_sha"] as string | undefined) ?? "";
      throw new ConflictError(sha, err);
    }

    if (code === "open_proposal_exists") {
      const id = (detail["existing_proposal_id"] as string | undefined) ?? "";
      throw new OpenProposalExistsError(id, err);
    }
  }

  throw err;
}
