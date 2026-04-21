import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { mapProposalError, ConflictError, OpenProposalExistsError } from "../errors";

function makeApiError(
  code: string,
  hint: Record<string, unknown> | null = null,
  status = 409,
): ApiError {
  return new ApiError(status, {
    code,
    message: "Test error",
    field: null,
    hint: hint ? JSON.stringify(hint) : null,
  });
}

describe("mapProposalError", () => {
  it("throws ConflictError with currentSha on stale_base_revision", () => {
    const original = makeApiError("stale_base_revision", {
      code: "stale_base_revision",
      current_sha: "deadbeef",
    });

    expect(() => mapProposalError(original)).toThrow(ConflictError);

    try {
      mapProposalError(original);
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError);
      const conflictErr = err as ConflictError;
      expect(conflictErr.currentSha).toBe("deadbeef");
      expect(conflictErr.status).toBe(409);
      expect(conflictErr.code).toBe("stale_base_revision");
    }
  });

  it("throws OpenProposalExistsError with existingProposalId on open_proposal_exists", () => {
    const existing_id = "22222222-0000-0000-0000-000000000001";
    const original = makeApiError("open_proposal_exists", {
      code: "open_proposal_exists",
      message: "An open proposal already exists for this content.",
      existing_proposal_id: existing_id,
    });

    expect(() => mapProposalError(original)).toThrow(OpenProposalExistsError);

    try {
      mapProposalError(original);
    } catch (err) {
      expect(err).toBeInstanceOf(OpenProposalExistsError);
      const existsErr = err as OpenProposalExistsError;
      expect(existsErr.existingProposalId).toBe(existing_id);
      expect(existsErr.status).toBe(409);
      expect(existsErr.code).toBe("open_proposal_exists");
    }
  });

  it("re-throws unknown ApiError unchanged", () => {
    const original = makeApiError("proposal_not_found", null, 404);
    expect(() => mapProposalError(original)).toThrow(ApiError);
    expect(() => mapProposalError(original)).not.toThrow(ConflictError);
  });

  it("re-throws non-ApiError errors unchanged", () => {
    const err = new Error("Network failure");
    expect(() => mapProposalError(err)).toThrow("Network failure");
  });

  it("ConflictError is an instance of ApiError", () => {
    const original = makeApiError("stale_base_revision", {
      code: "stale_base_revision",
      current_sha: "abc",
    });
    try {
      mapProposalError(original);
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toBeInstanceOf(ConflictError);
    }
  });

  it("OpenProposalExistsError is an instance of ApiError", () => {
    const original = makeApiError("open_proposal_exists", {
      code: "open_proposal_exists",
      existing_proposal_id: "some-id",
    });
    try {
      mapProposalError(original);
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toBeInstanceOf(OpenProposalExistsError);
    }
  });

  it("ConflictError.currentSha is empty string when current_sha missing", () => {
    const original = makeApiError("stale_base_revision", {
      code: "stale_base_revision",
      // no current_sha
    });
    try {
      mapProposalError(original);
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError);
      expect((err as ConflictError).currentSha).toBe("");
    }
  });
});
