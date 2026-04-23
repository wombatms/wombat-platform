import { describe, it, expect } from "vitest";
import {
  ApiError,
  mapRunError,
  RunClosedError,
  RunNotOpenError,
  ResultConflictError,
  UnauthorizedRunActionError,
  EvidenceTooLargeError,
  CaseNotInRunError,
  CaseAlreadyInRunError,
  EnvironmentNotFoundError,
  isApiError,
  SuiteCycleError,
  SuiteDepthLimitError,
  WidgetMissingFilterError,
  UnknownWidgetError,
  mapPlanningError,
} from "./errors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApiError(
  code: string,
  message = "error",
  status = 409,
  hint: string | null = null,
): ApiError {
  return new ApiError(status, { code, message, field: null, hint });
}

/**
 * Wrap mapRunError so tests can assert on the thrown value rather than
 * swallowing it.
 */
function callMapRunError(err: unknown): ApiError {
  try {
    mapRunError(err);
  } catch (thrown) {
    return thrown as ApiError;
  }
  throw new Error("mapRunError did not throw");
}

// ---------------------------------------------------------------------------
// ApiError base
// ---------------------------------------------------------------------------

describe("ApiError", () => {
  it("preserves status, code, message, field, hint", () => {
    const err = new ApiError(422, {
      code: "validation_error",
      message: "bad input",
      field: "name",
      hint: "must be non-empty",
    });
    expect(err.status).toBe(422);
    expect(err.code).toBe("validation_error");
    expect(err.message).toBe("bad input");
    expect(err.field).toBe("name");
    expect(err.hint).toBe("must be non-empty");
    expect(err.name).toBe("ApiError");
  });

  it("isApiError returns true for ApiError instances", () => {
    expect(isApiError(makeApiError("x"))).toBe(true);
  });

  it("isApiError returns false for plain errors", () => {
    expect(isApiError(new Error("plain"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// mapRunError — happy-path mapping per code
// ---------------------------------------------------------------------------

describe("mapRunError", () => {
  it("maps run_closed to RunClosedError", () => {
    const raw = makeApiError("run_closed", "Run is closed");
    const mapped = callMapRunError(raw);
    expect(mapped).toBeInstanceOf(RunClosedError);
    expect(mapped.name).toBe("RunClosedError");
    expect(mapped.message).toBe("Run is closed");
    expect(mapped.code).toBe("run_closed");
  });

  it("maps run_not_open to RunNotOpenError", () => {
    const raw = makeApiError("run_not_open", "Run is not open");
    const mapped = callMapRunError(raw);
    expect(mapped).toBeInstanceOf(RunNotOpenError);
    expect(mapped.name).toBe("RunNotOpenError");
    expect(mapped.code).toBe("run_not_open");
  });

  it("maps result_conflict to ResultConflictError with currentRevision", () => {
    const hint = JSON.stringify({ code: "result_conflict", current_revision: 4 });
    const raw = makeApiError("result_conflict", "stale", 409, hint);
    const mapped = callMapRunError(raw);
    expect(mapped).toBeInstanceOf(ResultConflictError);
    expect(mapped.name).toBe("ResultConflictError");
    expect((mapped as ResultConflictError).currentRevision).toBe(4);
  });

  it("maps result_conflict with revision 0 when hint is missing", () => {
    const raw = makeApiError("result_conflict", "stale", 409, null);
    const mapped = callMapRunError(raw);
    expect(mapped).toBeInstanceOf(ResultConflictError);
    expect((mapped as ResultConflictError).currentRevision).toBe(0);
  });

  it("maps result_conflict with revision 0 when hint is invalid JSON", () => {
    const raw = makeApiError("result_conflict", "stale", 409, "not-json");
    const mapped = callMapRunError(raw);
    expect(mapped).toBeInstanceOf(ResultConflictError);
    expect((mapped as ResultConflictError).currentRevision).toBe(0);
  });

  it("maps unauthorized_run_action to UnauthorizedRunActionError", () => {
    const raw = makeApiError("unauthorized_run_action", "Forbidden", 403);
    const mapped = callMapRunError(raw);
    expect(mapped).toBeInstanceOf(UnauthorizedRunActionError);
    expect(mapped.name).toBe("UnauthorizedRunActionError");
    expect(mapped.status).toBe(403);
  });

  it("maps evidence_too_large to EvidenceTooLargeError", () => {
    const raw = makeApiError("evidence_too_large", "File too large", 413);
    const mapped = callMapRunError(raw);
    expect(mapped).toBeInstanceOf(EvidenceTooLargeError);
    expect(mapped.name).toBe("EvidenceTooLargeError");
    expect(mapped.status).toBe(413);
  });

  it("maps case_not_in_run to CaseNotInRunError", () => {
    const raw = makeApiError("case_not_in_run", "Case not found in run");
    const mapped = callMapRunError(raw);
    expect(mapped).toBeInstanceOf(CaseNotInRunError);
    expect(mapped.name).toBe("CaseNotInRunError");
  });

  it("maps case_already_in_run to CaseAlreadyInRunError", () => {
    const raw = makeApiError("case_already_in_run", "Case already in run");
    const mapped = callMapRunError(raw);
    expect(mapped).toBeInstanceOf(CaseAlreadyInRunError);
    expect(mapped.name).toBe("CaseAlreadyInRunError");
  });

  it("maps environment_not_found to EnvironmentNotFoundError", () => {
    const raw = makeApiError("environment_not_found", "Env not found", 404);
    const mapped = callMapRunError(raw);
    expect(mapped).toBeInstanceOf(EnvironmentNotFoundError);
    expect(mapped.name).toBe("EnvironmentNotFoundError");
  });

  it("re-throws unknown ApiError codes unchanged", () => {
    const raw = makeApiError("some_other_code", "Unrecognised");
    const mapped = callMapRunError(raw);
    expect(mapped).toBe(raw);
    expect(mapped).toBeInstanceOf(ApiError);
    expect(mapped).not.toBeInstanceOf(RunClosedError);
  });

  it("re-throws non-ApiError errors unchanged", () => {
    const plain = new Error("network failure");
    try {
      mapRunError(plain);
      throw new Error("should have thrown");
    } catch (thrown) {
      expect(thrown).toBe(plain);
    }
  });

  it("re-throws string errors unchanged", () => {
    try {
      mapRunError("oops");
      throw new Error("should have thrown");
    } catch (thrown) {
      expect(thrown).toBe("oops");
    }
  });
});

// ---------------------------------------------------------------------------
// Subclass isinstance checks — confirm the hierarchy
// ---------------------------------------------------------------------------

describe("error class hierarchy", () => {
  it("RunClosedError is an ApiError", () => {
    const err = callMapRunError(makeApiError("run_closed"));
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(RunClosedError);
  });

  it("ResultConflictError is an ApiError", () => {
    const raw = makeApiError("result_conflict", "s", 409, JSON.stringify({ current_revision: 7 }));
    const err = callMapRunError(raw);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(ResultConflictError);
  });

  it("EvidenceTooLargeError is an ApiError", () => {
    const err = callMapRunError(makeApiError("evidence_too_large"));
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(EvidenceTooLargeError);
  });
});

// ---------------------------------------------------------------------------
// Hint parsing — result_conflict with a complex hint object
// ---------------------------------------------------------------------------

describe("ResultConflictError hint parsing", () => {
  it("extracts current_revision from a richer hint payload", () => {
    const hint = JSON.stringify({
      code: "result_conflict",
      current_revision: 12,
      current_status: "failed",
      updated_by: "user-abc",
    });
    const raw = makeApiError("result_conflict", "concurrent edit", 409, hint);
    const mapped = callMapRunError(raw) as ResultConflictError;
    expect(mapped.currentRevision).toBe(12);
    expect(mapped.message).toBe("concurrent edit");
    expect(mapped.hint).toBe(hint);
  });

  it("defaults currentRevision to 0 when current_revision is a string (bad server)", () => {
    const hint = JSON.stringify({ current_revision: "not-a-number" });
    const raw = makeApiError("result_conflict", "bad", 409, hint);
    const mapped = callMapRunError(raw) as ResultConflictError;
    expect(mapped.currentRevision).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// SP3.4 — mapPlanningError
// ---------------------------------------------------------------------------

/**
 * Wrap mapPlanningError so tests can assert on the thrown value.
 */
function callMapPlanningError(err: unknown): ApiError {
  try {
    mapPlanningError(err);
  } catch (thrown) {
    return thrown as ApiError;
  }
  throw new Error("mapPlanningError did not throw");
}

describe("mapPlanningError — SP3.4 typed errors", () => {
  it("maps SUITE_CYCLE (422) to SuiteCycleError", () => {
    const raw = makeApiError("SUITE_CYCLE", "Cycle detected in suite tree", 422);
    const mapped = callMapPlanningError(raw);
    expect(mapped).toBeInstanceOf(SuiteCycleError);
    expect(mapped.name).toBe("SuiteCycleError");
    expect(mapped.message).toBe("Cycle detected in suite tree");
    expect(mapped.code).toBe("SUITE_CYCLE");
    expect(mapped.status).toBe(422);
  });

  it("SuiteCycleError is an ApiError", () => {
    const raw = makeApiError("SUITE_CYCLE", "cycle", 422);
    expect(callMapPlanningError(raw)).toBeInstanceOf(ApiError);
  });

  it("maps SUITE_DEPTH_LIMIT (500) to SuiteDepthLimitError", () => {
    const raw = makeApiError("SUITE_DEPTH_LIMIT", "Suite tree exceeds depth limit", 500);
    const mapped = callMapPlanningError(raw);
    expect(mapped).toBeInstanceOf(SuiteDepthLimitError);
    expect(mapped.name).toBe("SuiteDepthLimitError");
    expect(mapped.code).toBe("SUITE_DEPTH_LIMIT");
    expect(mapped.status).toBe(500);
  });

  it("SuiteDepthLimitError is an ApiError", () => {
    const raw = makeApiError("SUITE_DEPTH_LIMIT", "too deep", 500);
    expect(callMapPlanningError(raw)).toBeInstanceOf(ApiError);
  });

  it("maps WIDGET_MISSING_FILTER (400) to WidgetMissingFilterError", () => {
    const raw = makeApiError(
      "WIDGET_MISSING_FILTER",
      "release_readiness requires plan_id",
      400,
    );
    const mapped = callMapPlanningError(raw);
    expect(mapped).toBeInstanceOf(WidgetMissingFilterError);
    expect(mapped.name).toBe("WidgetMissingFilterError");
    expect(mapped.code).toBe("WIDGET_MISSING_FILTER");
    expect(mapped.status).toBe(400);
    expect(mapped.message).toBe("release_readiness requires plan_id");
  });

  it("WidgetMissingFilterError is an ApiError", () => {
    const raw = makeApiError("WIDGET_MISSING_FILTER", "missing filter", 400);
    expect(callMapPlanningError(raw)).toBeInstanceOf(ApiError);
  });

  it("maps UNKNOWN_WIDGET (404) to UnknownWidgetError", () => {
    const raw = makeApiError("UNKNOWN_WIDGET", "Widget 'nope' is not registered", 404);
    const mapped = callMapPlanningError(raw);
    expect(mapped).toBeInstanceOf(UnknownWidgetError);
    expect(mapped.name).toBe("UnknownWidgetError");
    expect(mapped.code).toBe("UNKNOWN_WIDGET");
    expect(mapped.status).toBe(404);
  });

  it("UnknownWidgetError is an ApiError", () => {
    const raw = makeApiError("UNKNOWN_WIDGET", "not found", 404);
    expect(callMapPlanningError(raw)).toBeInstanceOf(ApiError);
  });

  it("re-throws unknown codes unchanged", () => {
    const raw = makeApiError("some_other_code", "unrecognised", 400);
    const mapped = callMapPlanningError(raw);
    expect(mapped).toBe(raw);
    expect(mapped).toBeInstanceOf(ApiError);
    expect(mapped).not.toBeInstanceOf(SuiteCycleError);
  });

  it("re-throws non-ApiError errors unchanged", () => {
    const plain = new Error("network failure");
    try {
      mapPlanningError(plain);
      throw new Error("should have thrown");
    } catch (thrown) {
      expect(thrown).toBe(plain);
    }
  });

  it("preserves field and hint on SuiteCycleError", () => {
    const raw = new ApiError(422, {
      code: "SUITE_CYCLE",
      message: "cycle",
      field: "parent_wombat_id",
      hint: "ancestor path: A → B → C",
    });
    const mapped = callMapPlanningError(raw) as SuiteCycleError;
    expect(mapped.field).toBe("parent_wombat_id");
    expect(mapped.hint).toBe("ancestor path: A → B → C");
  });
});
