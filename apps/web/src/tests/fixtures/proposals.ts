import type { ProposalResponse, ProposalSummary, ProposalDetail } from "@/features/proposals/api";

export const FIXTURE_PROPOSAL_ID = "11111111-0000-0000-0000-000000000001";
export const FIXTURE_PROPOSAL_ID_2 = "11111111-0000-0000-0000-000000000002";

export const FIXTURE_PROPOSAL_SUMMARY: ProposalSummary = {
  id: FIXTURE_PROPOSAL_ID,
  kind: "testcase",
  source_path: "testcases/TC-001.md",
  proposed_title: "Fix flaky login test",
  author_user_id: "00000000-0000-0000-0000-000000000001",
  author_kind: "human",
  status: "open",
  created_at: "2026-04-21T10:00:00Z",
  change_added: 5,
  change_removed: 2,
};

export const FIXTURE_PROPOSAL_SUMMARY_2: ProposalSummary = {
  id: FIXTURE_PROPOSAL_ID_2,
  kind: "story",
  source_path: "stories/US-002.md",
  proposed_title: "User story update",
  author_user_id: "00000000-0000-0000-0000-000000000002",
  author_kind: "human",
  status: "open",
  created_at: "2026-04-21T11:00:00Z",
  change_added: 3,
  change_removed: 1,
};

export const FIXTURE_PROPOSAL: ProposalResponse = {
  id: FIXTURE_PROPOSAL_ID,
  project_id: "aaaaaaaa-0000-0000-0000-000000000001",
  content_id: "cccccccc-0000-0000-0000-000000000001",
  kind: "testcase",
  source_path: "testcases/TC-001.md",
  base_revision: "abc123",
  proposed_title: "Fix flaky login test",
  proposed_body: { markdown: "## Steps\n1. Go to login page\n2. Enter credentials" },
  proposal_action: "upsert",
  summary: "Fixes the flaky assertion on step 3",
  author_user_id: "00000000-0000-0000-0000-000000000001",
  author_kind: "human",
  status: "open",
  published_sha: null,
  created_at: "2026-04-21T10:00:00Z",
  updated_at: "2026-04-21T10:00:00Z",
};

export const FIXTURE_PROPOSAL_DETAIL: ProposalDetail = {
  proposal: FIXTURE_PROPOSAL,
  before: { markdown: "## Steps\n1. Old step" },
  after: FIXTURE_PROPOSAL.proposed_body,
  events: [
    {
      id: "evvvvvvv-0000-0000-0000-000000000001",
      action: "created",
      user_id: "00000000-0000-0000-0000-000000000001",
      comment: null,
      detail: null,
      created_at: "2026-04-21T10:00:00Z",
    },
  ],
};

export const FIXTURE_PROPOSALS_LIST = {
  data: [FIXTURE_PROPOSAL_SUMMARY, FIXTURE_PROPOSAL_SUMMARY_2],
  pagination: { next_cursor: null },
};

export const FIXTURE_PROPOSALS_LIST_PAGE_1 = {
  data: [FIXTURE_PROPOSAL_SUMMARY],
  pagination: { next_cursor: "cursor-abc" },
};

export const FIXTURE_PROPOSALS_LIST_PAGE_2 = {
  data: [FIXTURE_PROPOSAL_SUMMARY_2],
  pagination: { next_cursor: null },
};
