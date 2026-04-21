import { http, HttpResponse } from "msw";
import {
  FIXTURE_USER,
  FIXTURE_TOKEN_RESPONSE,
  FIXTURE_REFRESHED_TOKEN_RESPONSE,
  FIXTURE_API_TOKEN_LIST,
  FIXTURE_CREATE_API_TOKEN_RESPONSE,
  KNOWN_EMAIL,
  KNOWN_PASSWORD,
} from "../fixtures/auth";
import type { Project } from "../../features/projects/useProjects";
import { FIXTURE_PROJECTS_LIST, FIXTURE_PROJECT_ALPHA, FIXTURE_PROJECT_BETA } from "../fixtures/projects";
import {
  FIXTURE_TESTCASES_LIST,
  FIXTURE_TESTCASE_1,
  FIXTURE_TESTCASE_2,
} from "../fixtures/testcases";
import {
  FIXTURE_SHARED_STEPS_LIST,
  FIXTURE_SHARED_STEP_1,
  FIXTURE_SHARED_STEP_2,
} from "../fixtures/shared-steps";
import { FIXTURE_STORIES_LIST, FIXTURE_STORY_1, FIXTURE_STORY_2 } from "../fixtures/stories";
import { FIXTURE_SEARCH_RESULT } from "../fixtures/search";
import {
  FIXTURE_PROPOSAL,
  FIXTURE_PROPOSAL_DETAIL,
  FIXTURE_PROPOSALS_LIST,
  FIXTURE_PROPOSAL_ID,
} from "../fixtures/proposals";

// Helper to build a lookup map from wombat_id
function byWombatId<T extends { wombat_id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((i) => [i.wombat_id, i]));
}

const testcaseMap = byWombatId([FIXTURE_TESTCASE_1, FIXTURE_TESTCASE_2]);
const sharedStepMap = byWombatId([FIXTURE_SHARED_STEP_1, FIXTURE_SHARED_STEP_2]);
const storyMap = byWombatId([FIXTURE_STORY_1, FIXTURE_STORY_2]);

const SLUG_FIXTURES = new Map<string, Project>([
  [FIXTURE_PROJECT_ALPHA.slug, FIXTURE_PROJECT_ALPHA as Project],
  [FIXTURE_PROJECT_BETA.slug, FIXTURE_PROJECT_BETA as Project],
]);

export const handlers = [
  // --- Auth ---

  http.post("*/api/auth/login", async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string };
    if (body.email === KNOWN_EMAIL && body.password === KNOWN_PASSWORD) {
      return HttpResponse.json(FIXTURE_TOKEN_RESPONSE);
    }
    return HttpResponse.json(
      { error: { code: "invalid_credentials", message: "Invalid email or password.", field: null, hint: null } },
      { status: 401 },
    );
  }),

  http.post("*/api/auth/refresh", async ({ request }) => {
    const body = (await request.json()) as { refresh_token: string };
    if (body.refresh_token?.startsWith("test-refresh") || body.refresh_token?.startsWith("refreshed-refresh")) {
      return HttpResponse.json(FIXTURE_REFRESHED_TOKEN_RESPONSE);
    }
    return HttpResponse.json(
      { error: { code: "invalid_token", message: "Invalid refresh token.", field: null, hint: null } },
      { status: 401 },
    );
  }),

  http.get("*/api/auth/me", ({ request }) => {
    const auth = request.headers.get("Authorization");
    if (auth?.startsWith("Bearer ")) {
      return HttpResponse.json(FIXTURE_USER);
    }
    return HttpResponse.json(
      { error: { code: "unauthorized", message: "Not authenticated.", field: null, hint: null } },
      { status: 401 },
    );
  }),

  http.post("*/api/auth/register", async ({ request }) => {
    const body = (await request.json()) as {
      email?: string;
      password?: string;
      display_name?: string;
    };
    if (!body.email || !body.password || !body.display_name) {
      return HttpResponse.json(
        { detail: [{ loc: ["body", "email"], msg: "Field required", type: "missing", input: body }] },
        { status: 422 },
      );
    }
    return HttpResponse.json(FIXTURE_USER, { status: 201 });
  }),

  // API tokens
  http.get("*/api/auth/api-tokens", () => {
    return HttpResponse.json(FIXTURE_API_TOKEN_LIST);
  }),

  http.post("*/api/auth/api-tokens", () => {
    return HttpResponse.json(FIXTURE_CREATE_API_TOKEN_RESPONSE, { status: 201 });
  }),

  http.delete("*/api/auth/api-tokens/:token_id", () => {
    return new HttpResponse(null, { status: 204 });
  }),

  // --- Projects ---

  http.get("*/api/projects/", () => {
    return HttpResponse.json(FIXTURE_PROJECTS_LIST);
  }),

  http.get("*/api/projects/:project_slug", ({ params }) => {
    const slug = params["project_slug"] as string;
    const project = SLUG_FIXTURES.get(slug);
    if (!project) {
      return HttpResponse.json(
        { error: { code: "not_found", message: `Project '${slug}' not found.`, field: null, hint: null } },
        { status: 404 },
      );
    }
    return HttpResponse.json(project);
  }),

  // --- Testcases ---

  http.get("*/api/projects/:project_slug/testcases", ({ params, request }) => {
    const slug = params["project_slug"] as string;
    if (!SLUG_FIXTURES.has(slug)) {
      return HttpResponse.json(
        { error: { code: "not_found", message: "Project not found.", field: null, hint: null } },
        { status: 404 },
      );
    }
    const url = new URL(request.url);
    const q = url.searchParams.get("q");
    const component = url.searchParams.get("component");

    let data = FIXTURE_TESTCASES_LIST.data;
    if (q) data = data.filter((tc) => tc.title.toLowerCase().includes(q.toLowerCase()));
    if (component) data = data.filter((tc) => tc.component === component);

    return HttpResponse.json({ data, total: data.length, limit: 50, offset: 0 });
  }),

  http.get("*/api/projects/:project_slug/testcases/:wombat_id", ({ params }) => {
    const wombatId = params["wombat_id"] as string;
    const tc = testcaseMap.get(wombatId);
    if (!tc) {
      return HttpResponse.json(
        { error: { code: "not_found", message: `Testcase '${wombatId}' not found.`, field: null, hint: null } },
        { status: 404 },
      );
    }
    return HttpResponse.json(tc);
  }),

  // --- Shared Steps ---

  http.get("*/api/projects/:project_slug/shared-steps", ({ params }) => {
    const slug = params["project_slug"] as string;
    if (!SLUG_FIXTURES.has(slug)) {
      return HttpResponse.json(
        { error: { code: "not_found", message: "Project not found.", field: null, hint: null } },
        { status: 404 },
      );
    }
    return HttpResponse.json(FIXTURE_SHARED_STEPS_LIST);
  }),

  http.get("*/api/projects/:project_slug/shared-steps/:wombat_id", ({ params }) => {
    const wombatId = params["wombat_id"] as string;
    const ss = sharedStepMap.get(wombatId);
    if (!ss) {
      return HttpResponse.json(
        { error: { code: "not_found", message: `Shared step '${wombatId}' not found.`, field: null, hint: null } },
        { status: 404 },
      );
    }
    return HttpResponse.json(ss);
  }),

  // --- Stories ---

  http.get("*/api/projects/:project_slug/stories", ({ params }) => {
    const slug = params["project_slug"] as string;
    if (!SLUG_FIXTURES.has(slug)) {
      return HttpResponse.json(
        { error: { code: "not_found", message: "Project not found.", field: null, hint: null } },
        { status: 404 },
      );
    }
    return HttpResponse.json(FIXTURE_STORIES_LIST);
  }),

  http.get("*/api/projects/:project_slug/stories/:wombat_id", ({ params }) => {
    const wombatId = params["wombat_id"] as string;
    const story = storyMap.get(wombatId);
    if (!story) {
      return HttpResponse.json(
        { error: { code: "not_found", message: `Story '${wombatId}' not found.`, field: null, hint: null } },
        { status: 404 },
      );
    }
    return HttpResponse.json(story);
  }),

  // --- Search ---

  http.post("*/api/projects/:project_slug/search", async ({ request }) => {
    const body = (await request.json()) as { query: string; mode?: string };
    return HttpResponse.json({
      ...FIXTURE_SEARCH_RESULT,
      query: body.query,
      mode: body.mode ?? "hybrid",
    });
  }),

  // --- Proposals ---

  http.get("*/api/projects/:project_slug/proposals", () => {
    return HttpResponse.json(FIXTURE_PROPOSALS_LIST);
  }),

  http.get("*/api/projects/:project_slug/proposals/:proposal_id", ({ params }) => {
    const proposalId = params["proposal_id"] as string;
    if (proposalId !== FIXTURE_PROPOSAL_ID) {
      return HttpResponse.json(
        { detail: { code: "proposal_not_found", message: "Proposal not found." } },
        { status: 404 },
      );
    }
    return HttpResponse.json({ data: FIXTURE_PROPOSAL_DETAIL });
  }),

  http.post("*/api/projects/:project_slug/proposals", async ({ request }) => {
    const url = new URL(request.url);
    const autoApprove = url.searchParams.get("auto_approve") === "true";
    const responseData = autoApprove
      ? { data: { proposal: FIXTURE_PROPOSAL, published_sha: "published-sha-abc123" } }
      : { data: { proposal: FIXTURE_PROPOSAL } };
    return HttpResponse.json(responseData, { status: 201 });
  }),

  http.put("*/api/projects/:project_slug/proposals/:proposal_id", () => {
    return HttpResponse.json({ data: FIXTURE_PROPOSAL });
  }),

  http.delete("*/api/projects/:project_slug/proposals/:proposal_id", () => {
    return new HttpResponse(null, { status: 204 });
  }),

  http.post("*/api/projects/:project_slug/proposals/:proposal_id/approve", () => {
    return HttpResponse.json({
      data: { proposal: { ...FIXTURE_PROPOSAL, status: "published" }, published_sha: "sha-approved" },
    });
  }),

  http.post("*/api/projects/:project_slug/proposals/:proposal_id/reject", () => {
    return HttpResponse.json({ data: { ...FIXTURE_PROPOSAL, status: "rejected" } });
  }),

  // --- Content (generic) ---

  http.get("*/api/projects/:project_slug/content/:content_id", ({ params }) => {
    const contentId = params["content_id"] as string;
    // Try to find by wombat_id across all fixtures
    const tc = testcaseMap.get(contentId);
    if (tc) return HttpResponse.json(tc);
    const ss = sharedStepMap.get(contentId);
    if (ss) return HttpResponse.json(ss);
    const story = storyMap.get(contentId);
    if (story) return HttpResponse.json(story);

    return HttpResponse.json(
      { error: { code: "not_found", message: `Content '${contentId}' not found.`, field: null, hint: null } },
      { status: 404 },
    );
  }),
];
