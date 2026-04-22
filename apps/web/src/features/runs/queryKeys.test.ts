import { describe, test, expect } from "vitest";
import { runKeys } from "./queryKeys";

describe("runKeys hierarchy", () => {
  const slug = "acme";
  const id = "run-abc-123";

  // ------------------------------------------------------------------ detail prefix
  test("detail key is a 4-element prefix of cases key", () => {
    const detail = runKeys.detail(slug, id);
    const cases = runKeys.cases(slug, id);
    expect(cases.slice(0, 4)).toEqual(detail);
  });

  test("detail key is a 4-element prefix of results key (no status)", () => {
    const detail = runKeys.detail(slug, id);
    const results = runKeys.results(slug, id);
    expect(results.slice(0, 4)).toEqual(detail);
  });

  test("detail key is a 4-element prefix of results key (with status)", () => {
    const detail = runKeys.detail(slug, id);
    const results = runKeys.results(slug, id, "pass");
    expect(results.slice(0, 4)).toEqual(detail);
  });

  test("detail key is a 4-element prefix of events key", () => {
    const detail = runKeys.detail(slug, id);
    const events = runKeys.events(slug, id);
    expect(events.slice(0, 4)).toEqual(detail);
  });

  test("detail key is a 4-element prefix of evidence key", () => {
    const detail = runKeys.detail(slug, id);
    const evidence = runKeys.evidence(slug, id, "result-xyz");
    expect(evidence.slice(0, 4)).toEqual(detail);
  });

  // ------------------------------------------------------------------ list stability
  test("list key is stable for identical filter objects", () => {
    const k1 = runKeys.list(slug, { status: "open", environment_id: "env-1" });
    const k2 = runKeys.list(slug, { status: "open", environment_id: "env-1" });
    expect(k1).toEqual(k2);
  });

  test("list key is stable with no filters provided", () => {
    const k1 = runKeys.list(slug);
    const k2 = runKeys.list(slug, undefined);
    expect(k1).toEqual(k2);
  });

  test("list key differs when filters differ", () => {
    const k1 = runKeys.list(slug, { status: "open" });
    const k2 = runKeys.list(slug, { status: "closed" });
    expect(k1).not.toEqual(k2);
  });

  // ------------------------------------------------------------------ namespacing
  test("environments key lives under separate namespace from runs", () => {
    expect(runKeys.environments(slug)[0]).toBe("environments");
    expect(runKeys.environments(slug)[0]).not.toBe("runs");
  });

  test("all key is the minimal namespace root", () => {
    const all = runKeys.all;
    const list = runKeys.list(slug);
    expect(list.slice(0, all.length)).toEqual(all);
  });

  test("lists key is a prefix of list key", () => {
    const lists = runKeys.lists(slug);
    const list = runKeys.list(slug, { status: "open" });
    expect(list.slice(0, lists.length)).toEqual(lists);
  });

  // ------------------------------------------------------------------ TanStack removeQueries contract
  // TanStack Query matches a key K against a stored key S if K is a prefix of S
  // (array prefix match). These tests document the exact prefix relationships so
  // cache invalidation callers can rely on them without reading source.
  test("detail key length is exactly 4", () => {
    expect(runKeys.detail(slug, id).length).toBe(4);
  });

  test("cases, results, events each have length > 4 (extend beyond detail)", () => {
    expect(runKeys.cases(slug, id).length).toBeGreaterThan(4);
    expect(runKeys.results(slug, id).length).toBeGreaterThan(4);
    expect(runKeys.events(slug, id).length).toBeGreaterThan(4);
  });
});
