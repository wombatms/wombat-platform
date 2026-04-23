/**
 * Proposal query + mutation hooks.
 *
 * Query hooks use `keys.proposal.*` for stable, hierarchical cache keys.
 * Mutation hooks throw ApiError (or the specialized ConflictError /
 * OpenProposalExistsError) — never raw Response objects.
 */

import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { keys, type ProposalListFilters } from "@/lib/query/keys";
import { mapProposalError } from "./errors";

// ---------------------------------------------------------------------------
// Shared types (mirroring the backend schema)
// ---------------------------------------------------------------------------

export interface ProposalSummary {
  id: string;
  kind: string;
  source_path: string;
  proposed_title: string;
  author_user_id: string;
  author_kind: string;
  status: string;
  created_at: string;
  change_added: number;
  change_removed: number;
}

export interface ProposalResponse {
  id: string;
  project_id: string;
  content_id: string | null;
  kind: string;
  source_path: string;
  base_revision: string;
  proposed_title: string;
  proposed_body: Record<string, unknown>;
  proposal_action: string;
  summary: string | null;
  author_user_id: string;
  author_kind: string;
  status: string;
  published_sha: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProposalEventResponse {
  id: string;
  action: string;
  user_id: string;
  comment: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export interface ProposalDetail {
  proposal: ProposalResponse;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  events: ProposalEventResponse[];
}

export interface ProposalListPage {
  data: ProposalSummary[];
  pagination: { next_cursor: string | null };
}

export interface ProposalCreateBody {
  kind: "testcase" | "shared_step" | "story" | "plan" | "suite";
  content_id?: string;
  source_path: string;
  base_revision: string;
  proposed_title: string;
  proposed_body: Record<string, unknown>;
  proposal_action?: "upsert" | "delete";
  summary?: string;
}

export interface ProposalUpdateBody {
  proposed_title?: string;
  proposed_body?: Record<string, unknown>;
  summary?: string;
  base_revision: string;
}

export interface ProposalActionBody {
  comment?: string;
}

// ---------------------------------------------------------------------------
// Query hooks
// ---------------------------------------------------------------------------

/**
 * Paginated list of proposals for a project.
 * Uses keepPreviousData so the UI doesn't flash on filter changes.
 */
export function useProposals(slug: string, filters: ProposalListFilters = {}) {
  return useQuery({
    queryKey: keys.proposal.list(slug, filters),
    queryFn: async (): Promise<ProposalListPage> => {
      const { data, error } = await api.GET(
        "/api/projects/{project_slug}/proposals",
        {
          params: {
            path: { project_slug: slug },
            query: {
              status: filters.status,
              kind: filters.kind,
              author_user_id: filters.author_user_id,
              author_kind: filters.author_kind,
              content_id: filters.content_id,
              cursor: filters.cursor,
              limit: filters.limit,
            },
          },
        },
      );
      if (error) throw error;
      return data as ProposalListPage;
    },
    placeholderData: keepPreviousData,
  });
}

/**
 * Inbox badge count — open proposals where the current user is a reviewer.
 * Intentionally uses a short stale time (30 s) configured at the call site
 * via the QueryClient default or via the staleTime option.
 */
export function useInboxBadge(slug: string) {
  return useQuery({
    queryKey: keys.proposal.inboxBadge(slug),
    queryFn: async (): Promise<number> => {
      const { data, error } = await api.GET(
        "/api/projects/{project_slug}/proposals",
        {
          params: {
            path: { project_slug: slug },
            query: { status: "open", limit: 1 },
          },
        },
      );
      if (error) throw error;
      const page = data as ProposalListPage;
      return page.data.length;
    },
    staleTime: 30_000,
  });
}

/**
 * Detail view for a single proposal including diff and event log.
 */
export function useProposal(slug: string, proposalId: string) {
  return useQuery({
    queryKey: keys.proposal.detail(slug, proposalId),
    queryFn: async (): Promise<ProposalDetail> => {
      const { data, error } = await api.GET(
        "/api/projects/{project_slug}/proposals/{proposal_id}",
        {
          params: { path: { project_slug: slug, proposal_id: proposalId } },
        },
      );
      if (error) throw error;
      return (data as { data: ProposalDetail }).data;
    },
    enabled: Boolean(slug && proposalId),
    refetchOnWindowFocus: false,
  });
}

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

/**
 * Create a new proposal. Pass `auto_approve: true` for direct-publish.
 * On 409, throws ConflictError or OpenProposalExistsError.
 */
export function useCreateProposal(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      args: ProposalCreateBody & { auto_approve?: boolean },
    ): Promise<{ proposal: ProposalResponse; published_sha?: string }> => {
      const { auto_approve, ...body } = args;
      try {
        const { data, error } = await api.POST(
          "/api/projects/{project_slug}/proposals",
          {
            params: {
              path: { project_slug: slug },
              query: { auto_approve: auto_approve ?? false },
            },
            body: body as Parameters<typeof api.POST>[1]["body"],
          },
        );
        if (error) throw error;
        return (data as { data: { proposal: ProposalResponse; published_sha?: string } }).data;
      } catch (err) {
        mapProposalError(err);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.proposal.all(slug) });
      void qc.invalidateQueries({ queryKey: keys.proposal.inboxBadge(slug) });
    },
  });
}

/**
 * Update an open proposal's body / title / base_revision.
 * On 409 stale_base_revision, throws ConflictError.
 */
export function useUpdateProposal(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      proposalId: string;
      body: ProposalUpdateBody;
    }): Promise<ProposalResponse> => {
      try {
        const { data, error } = await api.PUT(
          "/api/projects/{project_slug}/proposals/{proposal_id}",
          {
            params: { path: { project_slug: slug, proposal_id: args.proposalId } },
            body: args.body as Parameters<typeof api.PUT>[1]["body"],
          },
        );
        if (error) throw error;
        return (data as { data: ProposalResponse }).data;
      } catch (err) {
        mapProposalError(err);
      }
    },
    onSuccess: (_data, { proposalId }) => {
      void qc.invalidateQueries({ queryKey: keys.proposal.detail(slug, proposalId) });
      void qc.invalidateQueries({ queryKey: keys.proposal.all(slug) });
    },
  });
}

/**
 * Approve a proposal — publishes it to the Git workspace.
 * On 409 stale_base_revision, throws ConflictError.
 * Invalidates list, inboxBadge, and the underlying content detail.
 */
export function useApproveProposal(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      proposalId: string;
      body: ProposalActionBody;
    }): Promise<{ proposal: ProposalResponse; published_sha: string }> => {
      try {
        const { data, error } = await api.POST(
          "/api/projects/{project_slug}/proposals/{proposal_id}/approve",
          {
            params: { path: { project_slug: slug, proposal_id: args.proposalId } },
            body: args.body as Parameters<typeof api.POST>[1]["body"],
          },
        );
        if (error) throw error;
        return (data as { data: { proposal: ProposalResponse; published_sha: string } }).data;
      } catch (err) {
        mapProposalError(err);
      }
    },
    onSuccess: (_data, { proposalId }) => {
      void qc.invalidateQueries({ queryKey: keys.proposal.all(slug) });
      void qc.invalidateQueries({ queryKey: keys.proposal.inboxBadge(slug) });
      void qc.invalidateQueries({ queryKey: keys.proposal.detail(slug, proposalId) });
      // Invalidate content subtree — the published content may have changed.
      void qc.invalidateQueries({ queryKey: keys.project(slug) });
    },
  });
}

/**
 * Reject an open proposal.
 * Invalidates list and inboxBadge.
 */
export function useRejectProposal(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      proposalId: string;
      body: ProposalActionBody;
    }): Promise<ProposalResponse> => {
      try {
        const { data, error } = await api.POST(
          "/api/projects/{project_slug}/proposals/{proposal_id}/reject",
          {
            params: { path: { project_slug: slug, proposal_id: args.proposalId } },
            body: args.body as Parameters<typeof api.POST>[1]["body"],
          },
        );
        if (error) throw error;
        return (data as { data: ProposalResponse }).data;
      } catch (err) {
        mapProposalError(err);
      }
    },
    onSuccess: (_data, { proposalId }) => {
      void qc.invalidateQueries({ queryKey: keys.proposal.all(slug) });
      void qc.invalidateQueries({ queryKey: keys.proposal.inboxBadge(slug) });
      void qc.invalidateQueries({ queryKey: keys.proposal.detail(slug, proposalId) });
    },
  });
}

/**
 * Withdraw an open proposal (author action).
 * Invalidates list and inboxBadge.
 */
export function useWithdrawProposal(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { proposalId: string }): Promise<void> => {
      try {
        const { error } = await api.DELETE(
          "/api/projects/{project_slug}/proposals/{proposal_id}",
          {
            params: { path: { project_slug: slug, proposal_id: args.proposalId } },
          },
        );
        if (error) throw error;
      } catch (err) {
        mapProposalError(err);
      }
    },
    onSuccess: (_data, { proposalId }) => {
      void qc.invalidateQueries({ queryKey: keys.proposal.all(slug) });
      void qc.invalidateQueries({ queryKey: keys.proposal.inboxBadge(slug) });
      void qc.invalidateQueries({ queryKey: keys.proposal.detail(slug, proposalId) });
    },
  });
}

/**
 * Direct-publish: creates a proposal with auto_approve=true, bypassing the
 * review queue. Requires the `content:publish_direct` permission on the acting
 * token or role.
 */
export function useDirectPublish(slug: string) {
  const createProposal = useCreateProposal(slug);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      body: ProposalCreateBody,
    ): Promise<{ proposal: ProposalResponse; published_sha?: string }> => {
      const result = await createProposal.mutateAsync({ ...body, auto_approve: true });
      return result;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.proposal.all(slug) });
      void qc.invalidateQueries({ queryKey: keys.proposal.inboxBadge(slug) });
      void qc.invalidateQueries({ queryKey: keys.project(slug) });
    },
  });
}
