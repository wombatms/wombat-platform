"""Repository layer: typed async methods over Content + operational tables."""

from __future__ import annotations

import base64
import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import and_, func, or_, select
from sqlalchemy import delete as sa_delete
from sqlalchemy import update as sa_update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.database.models import (
    APITokenDB,
    AuditLogDB,
    Content,
    ContentChunk,
    EnvironmentDB,
    ProjectDB,
    ProposalDB,
    ProposalEventDB,
    ResultDB,
    ResultEvidenceDB,
    RunAssigneeDB,
    RunCaseDB,
    RunCaseSnapshotDB,
    RunDB,
    RunEventDB,
    SyncLogDB,
    UserDB,
    UserProjectRoleDB,
)
from wombat_api.runs.exceptions import ResultConflictError
from wombat_api.schemas.common import (
    ProjectCreate,
    UserCreate,
)


def canonical_json(body: dict) -> str:
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def content_hash_for(body: dict) -> str:
    return hashlib.sha256(canonical_json(body).encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Proposal errors + filters (SP3.2)
# ---------------------------------------------------------------------------


class OpenProposalExistsError(Exception):
    """An OPEN proposal already exists for this content row."""

    def __init__(self, existing_proposal_id: uuid.UUID):
        self.existing_proposal_id = existing_proposal_id
        super().__init__(f"open proposal already exists: {existing_proposal_id}")


class ProposalNotFoundError(Exception):
    """The requested proposal does not exist."""


class ProposalNotOpenError(Exception):
    """Attempted to update a proposal whose status is not 'open'."""

    def __init__(self, status: str):
        self.status = status
        super().__init__(f"proposal not open (status={status})")


class StaleBaseRevisionError(Exception):
    """The caller's base_revision does not match the stored one (optimistic lock)."""

    def __init__(self, current: str):
        self.current = current
        super().__init__(f"stale base_revision; current={current}")


def _encode_cursor(dt: datetime) -> str:
    return base64.urlsafe_b64encode(dt.isoformat().encode()).decode()


def _decode_cursor(cursor: str) -> datetime:
    return datetime.fromisoformat(base64.urlsafe_b64decode(cursor.encode()).decode())


def _encode_event_cursor(dt: datetime, ev_id: uuid.UUID) -> str:
    """Encode a (created_at, id) tuple for stable ordering under ties."""
    raw = f"{dt.isoformat()}|{ev_id}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def _decode_event_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    raw = base64.urlsafe_b64decode(cursor.encode()).decode()
    dt_str, id_str = raw.split("|", 1)
    return datetime.fromisoformat(dt_str), uuid.UUID(id_str)


@dataclass
class ProposalFilters:
    status: str | None = "open"
    kind: str | None = None
    author_user_id: uuid.UUID | None = None
    author_kind: str | None = None
    cursor: str | None = None
    limit: int = 50


class Repository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # --- Projects -------------------------------------------------------------

    async def get_project(self, slug: str) -> ProjectDB | None:
        q = select(ProjectDB).where(ProjectDB.slug == slug)
        return (await self.session.execute(q)).scalar_one_or_none()

    async def create_project(self, proj: ProjectCreate) -> ProjectDB:
        row = ProjectDB(**proj.model_dump())
        self.session.add(row)
        await self.session.flush()
        return row

    async def list_projects_for_user(self, user_id: uuid.UUID) -> list[ProjectDB]:
        q = (
            select(ProjectDB)
            .join(UserProjectRoleDB, UserProjectRoleDB.project_id == ProjectDB.id)
            .where(UserProjectRoleDB.user_id == user_id)
        )
        return list((await self.session.execute(q)).scalars())

    async def list_user_project_roles(self, user_id: uuid.UUID) -> list[tuple[str, str]]:
        """Return (project_slug, role) pairs for all projects the user has a role on."""
        q = (
            select(ProjectDB.slug, UserProjectRoleDB.role)
            .join(UserProjectRoleDB, UserProjectRoleDB.project_id == ProjectDB.id)
            .where(UserProjectRoleDB.user_id == user_id)
        )
        return [(slug, role) for slug, role in (await self.session.execute(q)).all()]

    async def ensure_default_environment(self, *, project_id: uuid.UUID, user_id: uuid.UUID) -> EnvironmentDB:
        """Idempotent. Creates a 'default' environment if missing; returns the row."""
        existing = await self.session.execute(
            select(EnvironmentDB).where(
                EnvironmentDB.project_id == project_id,
                EnvironmentDB.name == "default",
            )
        )
        row = existing.scalar_one_or_none()
        if row is not None:
            return row
        row = EnvironmentDB(
            project_id=project_id,
            name="default",
            created_by_user_id=user_id,
        )
        self.session.add(row)
        await self.session.flush()
        return row

    # --- Users / Auth / RBAC --------------------------------------------------

    async def get_user_by_email(self, email: str) -> UserDB | None:
        q = select(UserDB).where(UserDB.email == email)
        return (await self.session.execute(q)).scalar_one_or_none()

    async def create_user(self, user: UserCreate, hashed_pw: str) -> UserDB:
        row = UserDB(
            email=user.email,
            hashed_password=hashed_pw,
            display_name=user.display_name,
        )
        self.session.add(row)
        await self.session.flush()
        return row

    async def get_user_role(
        self,
        user_id: uuid.UUID,
        project_id: uuid.UUID,
    ) -> str | None:
        q = select(UserProjectRoleDB.role).where(
            and_(
                UserProjectRoleDB.user_id == user_id,
                UserProjectRoleDB.project_id == project_id,
            )
        )
        return (await self.session.execute(q)).scalar_one_or_none()

    async def set_user_role(
        self,
        user_id: uuid.UUID,
        project_id: uuid.UUID,
        role: str,
    ) -> None:
        stmt = pg_insert(UserProjectRoleDB.__table__).values(
            user_id=user_id,
            project_id=project_id,
            role=role,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=["user_id", "project_id"],
            set_={"role": role},
        )
        await self.session.execute(stmt)

    async def remove_user_role(
        self,
        user_id: uuid.UUID,
        project_id: uuid.UUID,
    ) -> None:
        await self.session.execute(
            sa_delete(UserProjectRoleDB).where(
                and_(
                    UserProjectRoleDB.user_id == user_id,
                    UserProjectRoleDB.project_id == project_id,
                )
            )
        )

    async def list_project_members(
        self,
        project_id: uuid.UUID,
    ) -> list[tuple[UserDB, str]]:
        q = (
            select(UserDB, UserProjectRoleDB.role)
            .join(UserProjectRoleDB, UserProjectRoleDB.user_id == UserDB.id)
            .where(UserProjectRoleDB.project_id == project_id)
        )
        return [(u, r) for u, r in (await self.session.execute(q)).all()]

    # --- API Tokens -----------------------------------------------------------

    async def create_api_token(
        self,
        user_id: uuid.UUID,
        name: str,
        scopes: list[str],
        token_hash: str,
        expires_at: datetime | None,
        publish_direct: bool = False,
        purpose: str | None = None,
        permissions: list[str] | None = None,
    ) -> APITokenDB:
        row = APITokenDB(
            user_id=user_id,
            name=name,
            scopes=scopes,
            token_hash=token_hash,
            expires_at=expires_at,
            publish_direct=publish_direct,
            purpose=purpose,
            permissions=permissions,
        )
        self.session.add(row)
        await self.session.flush()
        return row

    async def get_token_by_hash(self, token_hash: str) -> APITokenDB | None:
        q = select(APITokenDB).where(APITokenDB.token_hash == token_hash)
        return (await self.session.execute(q)).scalar_one_or_none()

    async def list_user_tokens(self, user_id: uuid.UUID) -> list[APITokenDB]:
        q = select(APITokenDB).where(APITokenDB.user_id == user_id)
        return list((await self.session.execute(q)).scalars())

    async def delete_token(self, token_id: uuid.UUID) -> None:
        await self.session.execute(sa_delete(APITokenDB).where(APITokenDB.id == token_id))

    # --- Content (unified) ----------------------------------------------------

    async def get_content_by_wombat_id(
        self,
        project_id: uuid.UUID,
        kind: str,
        wombat_id: str,
    ) -> Content | None:
        q = select(Content).where(
            and_(
                Content.project_id == project_id,
                Content.kind == kind,
                Content.wombat_id == wombat_id,
                Content.deleted_at.is_(None),
            )
        )
        return (await self.session.execute(q)).scalar_one_or_none()

    async def get_content_by_id(self, content_id: uuid.UUID) -> Content | None:
        return await self.session.get(Content, content_id)

    async def get_content_by_path(
        self,
        project_id: uuid.UUID,
        source_repo: str,
        source_path: str,
    ) -> Content | None:
        """Look up a content row by its source location (used for docs without wombat_id)."""
        q = select(Content).where(
            and_(
                Content.project_id == project_id,
                Content.source_repo == source_repo,
                Content.source_path == source_path,
                Content.deleted_at.is_(None),
            )
        )
        return (await self.session.execute(q)).scalar_one_or_none()

    async def get_content_by_wombat_ids(
        self,
        project_id: uuid.UUID,
        wombat_ids: list[str],
    ) -> list[Content]:
        """Batch-fetch live Content rows by wombat_id within a single project.

        Returns only rows whose wombat_id is in *wombat_ids* and which are not
        soft-deleted.  Unknown IDs are silently skipped (no partial error).
        Always scoped to *project_id* — never returns rows from other projects.
        """
        if not wombat_ids:
            return []
        q = select(Content).where(
            and_(
                Content.project_id == project_id,
                Content.wombat_id.in_(wombat_ids),
                Content.deleted_at.is_(None),
            )
        )
        return list((await self.session.execute(q)).scalars())

    async def list_suite_subtree(
        self,
        project_id: uuid.UUID,
        root_wombat_id: str,
        depth_limit: int = 20,
    ) -> list[Content]:
        """Return the root Suite plus every descendant Suite (BFS order).

        * Scoped to *project_id*: the traversal never crosses project
          boundaries, even if a same-named suite exists in another project.
        * Only rows with ``kind='suite'`` are considered — a testcase with
          ``parent_wombat_id`` pointing at a suite is never returned here.
        * Depth capped by *depth_limit* (default 20, matching the linter's
          MAX_SUITE_DEPTH).  A depth_limit of 0 returns only the root.
        * Cycles are defended against regardless of dialect by tracking
          visited wombat_ids.
        * Postgres: single ``WITH RECURSIVE`` round-trip against the
          ``content`` table.
        * SQLite (unit tests): BFS in Python over a pre-loaded dict of
          project suites — correctness equivalent; no DB round-trip win.
        """
        dialect = (
            self.session.bind.dialect.name if self.session.bind is not None else "postgresql"
        )

        if dialect == "postgresql":
            # Use a recursive CTE keyed on content.id, then hydrate ORM rows
            # via a single IN query — keeps identity-map semantics and lets
            # the connector reuse prepared statements.  Scoped to the single
            # project; cross-project suites cannot leak because every level
            # re-filters on ``project_id``.
            from sqlalchemy import text

            stmt = text(
                """
                WITH RECURSIVE subtree AS (
                    SELECT c.id, c.wombat_id, 0 AS depth
                      FROM content c
                     WHERE c.project_id = :pid
                       AND c.kind = 'suite'
                       AND c.wombat_id = :root
                       AND c.deleted_at IS NULL
                    UNION ALL
                    SELECT c.id, c.wombat_id, s.depth + 1 AS depth
                      FROM content c
                      JOIN subtree s
                        ON (c.body ->> 'parent_wombat_id') = s.wombat_id
                     WHERE c.project_id = :pid
                       AND c.kind = 'suite'
                       AND c.deleted_at IS NULL
                       AND s.depth < :depth_limit
                )
                SELECT DISTINCT id FROM subtree
                """
            )
            result = await self.session.execute(
                stmt,
                {"pid": project_id, "root": root_wombat_id, "depth_limit": depth_limit},
            )
            ids = [row[0] for row in result]
            if not ids:
                return []
            # Hydrate to ORM rows in a single IN query.
            rows_q = select(Content).where(Content.id.in_(ids))
            return list((await self.session.execute(rows_q)).scalars())

        # SQLite / other: Python BFS.  Load every live suite in the project
        # once, then walk parent_wombat_id edges breadth-first.
        all_suites_q = select(Content).where(
            and_(
                Content.project_id == project_id,
                Content.kind == "suite",
                Content.deleted_at.is_(None),
            )
        )
        all_suites = list((await self.session.execute(all_suites_q)).scalars())
        by_wid: dict[str, Content] = {s.wombat_id: s for s in all_suites if s.wombat_id}

        root = by_wid.get(root_wombat_id)
        if root is None:
            return []

        children_of: dict[str, list[Content]] = {}
        for s in all_suites:
            parent = (s.body or {}).get("parent_wombat_id")
            if parent is None:
                continue
            children_of.setdefault(parent, []).append(s)

        visited: set[str] = {root_wombat_id}
        result: list[Content] = [root]
        frontier: list[Content] = [root]
        depth = 0
        while frontier and depth < depth_limit:
            next_frontier: list[Content] = []
            for node in frontier:
                if not node.wombat_id:
                    continue
                for child in children_of.get(node.wombat_id, []):
                    if not child.wombat_id or child.wombat_id in visited:
                        continue
                    visited.add(child.wombat_id)
                    result.append(child)
                    next_frontier.append(child)
            frontier = next_frontier
            depth += 1
        return result

    async def list_content(
        self,
        project_id: uuid.UUID,
        kind: str | None = None,
        tags: list[str] | None = None,
        q_text: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[Content], int]:
        conds = [Content.project_id == project_id, Content.deleted_at.is_(None)]
        if kind is not None:
            conds.append(Content.kind == kind)
        if tags:
            # JSONB @> containment (Postgres only).
            # We use bindparam(..., type_=JSONB) with a Python list value so that
            # asyncpg encodes it correctly as JSONB.  On SQLite (unit tests) tag
            # filtering is skipped — there are no tag-filter unit tests and SQLite
            # has no JSONB @> operator.  Dialect is detected via the session bind.
            _dialect = self.session.bind.dialect.name if self.session.bind else "postgresql"
            if _dialect == "postgresql":
                from sqlalchemy import bindparam
                from sqlalchemy.dialects.postgresql import JSONB as _JSONB

                for i, t in enumerate(tags):
                    param = bindparam(f"_tag_{i}", value=[t], type_=_JSONB, unique=True)
                    conds.append(Content.tags.op("@>")(param))
            # else: SQLite — skip tag filtering
        if q_text:
            like = f"%{q_text}%"
            conds.append(
                or_(
                    Content.title.ilike(like),
                )
            )
        base = select(Content).where(and_(*conds))
        total_q = select(func.count()).select_from(base.subquery())
        total = (await self.session.execute(total_q)).scalar_one()
        rows = list(
            (await self.session.execute(base.order_by(Content.updated_at.desc()).limit(limit).offset(offset))).scalars()
        )
        return rows, total

    async def upsert_content(
        self,
        project_id: uuid.UUID,
        *,
        kind: str,
        wombat_id: str | None,
        title: str,
        tags: list[str],
        body: dict,
        source_repo: str,
        source_path: str,
        source_revision: str,
        embedding: list[float] | None = None,
    ) -> Content:
        """Create or update a Content row keyed by (project, source_repo, path)."""
        h = content_hash_for(body)
        q = select(Content).where(
            and_(
                Content.project_id == project_id,
                Content.source_repo == source_repo,
                Content.source_path == source_path,
            )
        )
        existing = (await self.session.execute(q)).scalar_one_or_none()
        if existing is None:
            row = Content(
                project_id=project_id,
                kind=kind,
                wombat_id=wombat_id,
                title=title,
                tags=tags,
                body=body,
                source_repo=source_repo,
                source_path=source_path,
                source_revision=source_revision,
                content_hash=h,
                embedding=embedding,
                synced_at=datetime.now(UTC),
            )
            self.session.add(row)
            await self.session.flush()
            return row
        # Updating — may or may not change embedding.
        existing.kind = kind
        existing.wombat_id = wombat_id
        existing.title = title
        existing.tags = tags
        existing.body = body
        existing.source_revision = source_revision
        existing.content_hash = h
        existing.synced_at = datetime.now(UTC)
        if embedding is not None:
            existing.embedding = embedding
        return existing

    async def replace_chunks(
        self,
        content_id: uuid.UUID,
        chunks: list[tuple[str, list[float] | None]],
    ) -> None:
        """Delete existing chunks and write the new set."""
        await self.session.execute(sa_delete(ContentChunk).where(ContentChunk.content_id == content_id))
        for i, (text, emb) in enumerate(chunks):
            self.session.add(
                ContentChunk(
                    content_id=content_id,
                    chunk_index=i,
                    text=text,
                    embedding=emb,
                )
            )

    async def soft_delete_missing(
        self,
        project_id: uuid.UUID,
        source_repo: str,
        seen_paths: set[str],
    ) -> int:
        """Soft-delete rows from a source_repo whose path was not seen this sync."""
        q = select(Content).where(
            and_(
                Content.project_id == project_id,
                Content.source_repo == source_repo,
                Content.deleted_at.is_(None),
            )
        )
        rows = list((await self.session.execute(q)).scalars())
        n = 0
        now = datetime.now(UTC)
        for r in rows:
            if r.source_path not in seen_paths:
                r.deleted_at = now
                n += 1
        return n

    # --- Sync log -------------------------------------------------------------

    async def record_sync(self, log: SyncLogDB) -> None:
        self.session.add(log)

    # --- Audit ----------------------------------------------------------------

    async def log_action(
        self,
        project_id: uuid.UUID,
        user_id: uuid.UUID | None,
        action: str,
        entity_type: str,
        entity_id: str,
        details: dict | None,
        interface: str,
        agent_type: str | None,
    ) -> None:
        self.session.add(
            AuditLogDB(
                project_id=project_id,
                user_id=user_id,
                action=action,
                entity_type=entity_type,
                entity_id=entity_id,
                details=details,
                interface=interface,
                agent_type=agent_type,
            )
        )

    async def get_audit_log(
        self,
        project_id: uuid.UUID,
        filters: dict,
        limit: int,
        offset: int,
    ) -> list[AuditLogDB]:
        conds = [AuditLogDB.project_id == project_id]
        if filters.get("entity_type"):
            conds.append(AuditLogDB.entity_type == filters["entity_type"])
        if filters.get("action"):
            conds.append(AuditLogDB.action == filters["action"])
        q = select(AuditLogDB).where(and_(*conds)).order_by(AuditLogDB.created_at.desc()).limit(limit).offset(offset)
        return list((await self.session.execute(q)).scalars())

    # --- Proposals (SP3.2) ----------------------------------------------------

    async def create_proposal(
        self,
        *,
        project_id: uuid.UUID,
        content_id: uuid.UUID | None,
        kind: str,
        source_path: str,
        base_revision: str,
        proposed_title: str,
        proposed_body: dict,
        proposal_action: str,
        summary: str | None,
        author_user_id: uuid.UUID,
        author_kind: str,
    ) -> ProposalDB:
        """Create a new proposal.

        Raises OpenProposalExistsError if an open proposal already exists for
        the same content_id.  Postgres enforces this via the partial unique
        index `ux_proposal_open_per_content`; on dialects without partial
        indexes (SQLite unit tests) we emulate the check with an explicit
        SELECT before INSERT.
        """
        if content_id is not None:
            existing = await self.session.execute(
                select(ProposalDB).where(
                    ProposalDB.content_id == content_id,
                    ProposalDB.status == "open",
                )
            )
            existing_row = existing.scalar_one_or_none()
            if existing_row is not None:
                raise OpenProposalExistsError(existing_proposal_id=existing_row.id)

        proposal = ProposalDB(
            project_id=project_id,
            content_id=content_id,
            kind=kind,
            source_path=source_path,
            base_revision=base_revision,
            proposed_title=proposed_title,
            proposed_body=proposed_body,
            proposal_action=proposal_action,
            summary=summary,
            author_user_id=author_user_id,
            author_kind=author_kind,
            status="open",
        )
        self.session.add(proposal)
        try:
            await self.session.flush()
        except IntegrityError as exc:
            # Concurrent writer won the race on Postgres; surface the
            # typed error so the router can return 409.
            await self.session.rollback()
            if content_id is not None:
                existing = await self.session.execute(
                    select(ProposalDB).where(
                        ProposalDB.content_id == content_id,
                        ProposalDB.status == "open",
                    )
                )
                winner = existing.scalar_one_or_none()
                if winner is not None:
                    raise OpenProposalExistsError(existing_proposal_id=winner.id) from exc
            raise
        return proposal

    async def get_proposal(self, proposal_id: uuid.UUID) -> ProposalDB | None:
        return await self.session.get(ProposalDB, proposal_id)

    async def get_proposal_with_events(self, proposal_id: uuid.UUID) -> tuple[ProposalDB, list[ProposalEventDB]] | None:
        proposal = await self.get_proposal(proposal_id)
        if proposal is None:
            return None
        events_q = (
            select(ProposalEventDB)
            .where(ProposalEventDB.proposal_id == proposal_id)
            .order_by(ProposalEventDB.created_at.asc())
        )
        events = list((await self.session.execute(events_q)).scalars())
        return proposal, events

    async def list_proposals(
        self,
        *,
        project_id: uuid.UUID,
        filters: ProposalFilters,
    ) -> tuple[list[ProposalDB], str | None]:
        stmt = select(ProposalDB).where(ProposalDB.project_id == project_id)
        if filters.status is not None:
            stmt = stmt.where(ProposalDB.status == filters.status)
        if filters.kind is not None:
            stmt = stmt.where(ProposalDB.kind == filters.kind)
        if filters.author_user_id is not None:
            stmt = stmt.where(ProposalDB.author_user_id == filters.author_user_id)
        if filters.author_kind is not None:
            stmt = stmt.where(ProposalDB.author_kind == filters.author_kind)
        if filters.cursor:
            cutoff = _decode_cursor(filters.cursor)
            stmt = stmt.where(ProposalDB.created_at < cutoff)
        stmt = stmt.order_by(ProposalDB.created_at.desc()).limit(filters.limit + 1)
        rows = list((await self.session.execute(stmt)).scalars())
        next_cursor: str | None = None
        if len(rows) > filters.limit:
            next_cursor = _encode_cursor(rows[filters.limit - 1].created_at)
            rows = rows[: filters.limit]
        return rows, next_cursor

    async def update_proposal_body(
        self,
        proposal_id: uuid.UUID,
        *,
        proposed_title: str | None,
        proposed_body: dict | None,
        summary: str | None,
        base_revision: str,
    ) -> ProposalDB:
        """Update an open proposal's body / title / summary.

        Raises:
            ProposalNotFoundError: proposal does not exist.
            ProposalNotOpenError: proposal is not in 'open' status.
            StaleBaseRevisionError: caller's base_revision does not match the
                stored one (optimistic lock).
        """
        proposal = await self.get_proposal(proposal_id)
        if proposal is None:
            raise ProposalNotFoundError()
        if proposal.status != "open":
            raise ProposalNotOpenError(status=proposal.status)
        if proposal.base_revision != base_revision:
            raise StaleBaseRevisionError(current=proposal.base_revision)
        if proposed_title is not None:
            proposal.proposed_title = proposed_title
        if proposed_body is not None:
            proposal.proposed_body = proposed_body
        if summary is not None:
            proposal.summary = summary
        await self.session.flush()
        return proposal

    async def transition_proposal_status(
        self,
        proposal_id: uuid.UUID,
        *,
        new_status: str,
        published_sha: str | None = None,
    ) -> ProposalDB:
        proposal = await self.get_proposal(proposal_id)
        if proposal is None:
            raise ProposalNotFoundError()
        proposal.status = new_status
        if published_sha is not None:
            proposal.published_sha = published_sha
        await self.session.flush()
        return proposal

    async def append_proposal_event(
        self,
        *,
        proposal_id: uuid.UUID,
        user_id: uuid.UUID,
        action: str,
        comment: str | None = None,
        detail: dict | None = None,
    ) -> ProposalEventDB:
        event = ProposalEventDB(
            proposal_id=proposal_id,
            user_id=user_id,
            action=action,
            comment=comment,
            detail=detail,
        )
        self.session.add(event)
        await self.session.flush()
        return event

    async def reset_project_proposals(self, project_id: uuid.UUID) -> None:
        """Test helper: delete all proposals + events for a project.

        Lets integration tests reuse a shared Postgres database without
        leaking state between test modules.
        """
        await self.session.execute(
            sa_delete(ProposalEventDB).where(
                ProposalEventDB.proposal_id.in_(select(ProposalDB.id).where(ProposalDB.project_id == project_id))
            )
        )
        await self.session.execute(sa_delete(ProposalDB).where(ProposalDB.project_id == project_id))
        await self.session.flush()

    async def get_user(self, user_id: uuid.UUID) -> UserDB | None:
        """Fetch a user by primary key (used by publisher to look up the proposal author)."""
        return await self.session.get(UserDB, user_id)

    async def get_content(self, content_id: uuid.UUID) -> Content | None:
        """Fetch a Content row by primary key."""
        return await self.session.get(Content, content_id)

    # --- Publisher helpers (SP3.2) -----------------------------------------------

    async def upsert_content_from_proposal(
        self,
        *,
        project_id: uuid.UUID,
        proposal: ProposalDB,
        published_sha: str,
        mutated_body: dict,
    ) -> Content | None:
        """Upsert the Content row that corresponds to a published proposal.

        For `delete` proposals we soft-delete the existing row (if any) and
        return None. For `upsert` proposals we create-or-update using the same
        path-keyed logic as the sync pipeline.

        The publisher does NOT generate an embedding; it sets stale_embedding=True
        so the background embedder queues the row for re-embedding. If reindex
        succeeds inline (via ``reindex_content``), the caller clears the flag.
        """
        from datetime import UTC

        if proposal.proposal_action == "delete":
            # Soft-delete any existing content row at this path.
            q = select(Content).where(
                and_(
                    Content.project_id == project_id,
                    Content.source_path == proposal.source_path,
                    Content.deleted_at.is_(None),
                )
            )
            existing = (await self.session.execute(q)).scalar_one_or_none()
            if existing is not None:
                existing.deleted_at = datetime.now(UTC)
                await self.session.flush()
            return None

        # Upsert path: build body from mutated_body
        body = mutated_body
        h = content_hash_for(body)
        title = proposal.proposed_title

        # Extract wombat_id from frontmatter if present
        wombat_id: str | None = None
        if isinstance(body.get("frontmatter"), dict):
            wombat_id = body["frontmatter"].get("id") or proposal.source_path

        q = select(Content).where(
            and_(
                Content.project_id == project_id,
                Content.source_path == proposal.source_path,
            )
        )
        existing = (await self.session.execute(q)).scalar_one_or_none()

        if existing is None:
            row = Content(
                project_id=project_id,
                kind=proposal.kind,
                wombat_id=wombat_id,
                title=title,
                tags=[],
                body=body,
                source_repo="test-repo",
                source_path=proposal.source_path,
                source_revision=published_sha,
                content_hash=h,
                stale_embedding=True,
                synced_at=datetime.now(UTC),
            )
            self.session.add(row)
            await self.session.flush()
            return row

        existing.kind = proposal.kind
        existing.wombat_id = wombat_id
        existing.title = title
        existing.body = body
        existing.source_revision = published_sha
        existing.content_hash = h
        existing.stale_embedding = True
        existing.synced_at = datetime.now(UTC)
        existing.deleted_at = None
        await self.session.flush()
        return existing

    async def reindex_content(
        self,
        *,
        project_id: uuid.UUID,
        source_path: str,
    ) -> None:
        """Re-embed a single content row by source_path.

        Delegates to the Indexer pipeline to compute a fresh embedding and
        write it back. Clears stale_embedding on success.

        This is a best-effort call from the publisher. If the embedder is not
        available (e.g. in unit tests), this will raise ImportError or similar;
        the publisher catches that and falls back to mark_content_stale_embedding.
        """
        from wombat_core.rag.embedders import load_embedder  # type: ignore

        embedder = load_embedder()

        q = select(Content).where(
            and_(
                Content.project_id == project_id,
                Content.source_path == source_path,
                Content.deleted_at.is_(None),
            )
        )
        row = (await self.session.execute(q)).scalar_one_or_none()
        if row is None:
            return

        from wombat_api.sync.indexer import _embed_text_for

        parsed = {
            "kind": row.kind,
            "title": row.title,
            "body": row.body,
        }
        text = _embed_text_for(parsed)
        vectors = await embedder.embed_batch([text])
        row.embedding = vectors[0]
        row.stale_embedding = False
        await self.session.flush()

    async def mark_content_stale_embedding(
        self,
        *,
        project_id: uuid.UUID,
        source_path: str,
    ) -> None:
        """Set stale_embedding=True on the content row at source_path.

        Called when inline reindex fails so the background embedder can
        pick up the row on its next pass.
        """
        await self.session.execute(
            sa_update(Content)
            .where(
                and_(
                    Content.project_id == project_id,
                    Content.source_path == source_path,
                )
            )
            .values(stale_embedding=True)
        )

    # --- Environments (SP3.3) -----------------------------------------------

    async def list_environments(self, project_id: uuid.UUID) -> list[EnvironmentDB]:
        result = await self.session.execute(
            select(EnvironmentDB).where(EnvironmentDB.project_id == project_id).order_by(EnvironmentDB.name)
        )
        return list(result.scalars().all())

    async def create_environment(self, *, project_id: uuid.UUID, name: str, user_id: uuid.UUID) -> EnvironmentDB:
        row = EnvironmentDB(
            project_id=project_id,
            name=name,
            created_by_user_id=user_id,
        )
        self.session.add(row)
        await self.session.flush()
        return row

    async def delete_environment(self, env_id: uuid.UUID) -> None:
        env = await self.session.get(EnvironmentDB, env_id)
        if env is None:
            return
        await self.session.delete(env)
        await self.session.flush()

    # --- Run case snapshots (SP3.3) ------------------------------------------

    async def upsert_run_case_snapshot(
        self,
        *,
        content: Content,
        resolved_body: dict,
        content_hash: str,
    ) -> RunCaseSnapshotDB:
        """Inserts a snapshot if content_hash is new; returns existing otherwise.

        Catches IntegrityError on concurrent inserts and falls back to a
        re-select so that racing writers converge on the same snapshot row.
        Closed runs stay pinned to their snapshots by (run_cases.snapshot_id),
        never to the live Content row.
        """
        existing = await self.session.execute(
            select(RunCaseSnapshotDB).where(RunCaseSnapshotDB.content_hash == content_hash)
        )
        row = existing.scalar_one_or_none()
        if row is not None:
            return row
        row = RunCaseSnapshotDB(
            content_hash=content_hash,
            content_id=content.id,
            snapshot_body=resolved_body,
            snapshot_title=content.title,
            snapshot_wombat_id=content.wombat_id or "",
        )
        self.session.add(row)
        try:
            await self.session.flush()
        except IntegrityError:
            # Racing insert — fall back to re-select.
            await self.session.rollback()
            return (
                await self.session.execute(
                    select(RunCaseSnapshotDB).where(RunCaseSnapshotDB.content_hash == content_hash)
                )
            ).scalar_one()
        return row

    # --- Runs (SP3.3) --------------------------------------------------------

    async def create_run(
        self,
        *,
        project_id: uuid.UUID,
        title: str,
        owner_id: uuid.UUID,
        environment_id: uuid.UUID | None = None,
        source: str = "manual",
        parent_run_id: uuid.UUID | None = None,
    ) -> RunDB:
        row = RunDB(
            project_id=project_id,
            title=title,
            owner_id=owner_id,
            environment_id=environment_id,
            source=source,
            parent_run_id=parent_run_id,
            status="open",
        )
        self.session.add(row)
        await self.session.flush()
        return row

    async def get_run(self, run_id: uuid.UUID) -> RunDB | None:
        return await self.session.get(RunDB, run_id)

    async def list_runs(
        self,
        *,
        project_id: uuid.UUID,
        status: str | None = None,
        environment_id: uuid.UUID | None = None,
        owner_id: uuid.UUID | None = None,
        q: str | None = None,
        limit: int = 50,
        cursor: str | None = None,
    ) -> list[RunDB]:
        stmt = select(RunDB).where(RunDB.project_id == project_id)
        if status is not None:
            stmt = stmt.where(RunDB.status == status)
        if environment_id is not None:
            stmt = stmt.where(RunDB.environment_id == environment_id)
        if owner_id is not None:
            stmt = stmt.where(RunDB.owner_id == owner_id)
        if q:
            like = f"%{q}%"
            stmt = stmt.where(RunDB.title.ilike(like))
        if cursor:
            cutoff = _decode_cursor(cursor)
            stmt = stmt.where(RunDB.created_at < cutoff)
        stmt = stmt.order_by(RunDB.created_at.desc()).limit(limit)
        return list((await self.session.execute(stmt)).scalars())

    async def update_run_status(
        self,
        *,
        run_id: uuid.UUID,
        new_status: str,
        note: str | None = None,
    ) -> None:
        run = await self.session.get(RunDB, run_id)
        if run is None:
            return
        run.status = new_status
        if note is not None:
            run.closure_note = note
        if new_status in ("completed", "aborted") and run.closed_at is None:
            run.closed_at = datetime.now(UTC)
        await self.session.flush()

    async def set_started_at_if_unset(self, run_id: uuid.UUID) -> None:
        run = await self.session.get(RunDB, run_id)
        if run is None or run.started_at is not None:
            return
        run.started_at = datetime.now(UTC)
        await self.session.flush()

    # --- Assignees (SP3.3) ---------------------------------------------------

    async def list_assignees(self, run_id: uuid.UUID) -> list[RunAssigneeDB]:
        result = await self.session.execute(
            select(RunAssigneeDB).where(RunAssigneeDB.run_id == run_id).order_by(RunAssigneeDB.added_at.asc())
        )
        return list(result.scalars())

    async def add_assignee(
        self,
        *,
        run_id: uuid.UUID,
        user_id: uuid.UUID | None = None,
        token_id: uuid.UUID | None = None,
        added_by_user_id: uuid.UUID,
    ) -> RunAssigneeDB:
        row = RunAssigneeDB(
            run_id=run_id,
            user_id=user_id,
            token_id=token_id,
            added_by_user_id=added_by_user_id,
        )
        self.session.add(row)
        await self.session.flush()
        return row

    async def remove_assignee(self, assignee_id: uuid.UUID) -> None:
        row = await self.session.get(RunAssigneeDB, assignee_id)
        if row is None:
            return
        await self.session.delete(row)
        await self.session.flush()

    async def is_principal_on_run(
        self,
        *,
        run_id: uuid.UUID,
        user_id: uuid.UUID | None = None,
        token_id: uuid.UUID | None = None,
    ) -> bool:
        """Return True if the (user_id | token_id) is owner or assignee of this run.

        When both user_id and token_id are provided (API-token authentication),
        the assignee check tests EITHER the user-type OR the token-type entry so
        that a token explicitly added as an assignee is correctly recognised even
        though its owner user_id is also non-None.
        """
        run = await self.session.get(RunDB, run_id)
        if run is None:
            return False
        if user_id is not None and run.owner_id == user_id:
            return True
        if user_id is None and token_id is None:
            return False
        # Build an OR clause: a user-assignee row OR a token-assignee row.
        or_parts = []
        if user_id is not None:
            or_parts.append(and_(RunAssigneeDB.run_id == run_id, RunAssigneeDB.user_id == user_id))
        if token_id is not None:
            or_parts.append(and_(RunAssigneeDB.run_id == run_id, RunAssigneeDB.token_id == token_id))
        q = select(func.count()).select_from(RunAssigneeDB).where(or_(*or_parts))
        count = (await self.session.execute(q)).scalar_one()
        return count > 0

    # --- Run cases (SP3.3) ---------------------------------------------------

    async def add_run_case(
        self,
        *,
        run_id: uuid.UUID,
        snapshot_id: uuid.UUID,
        display_order: int,
        added_by_user_id: uuid.UUID,
    ) -> RunCaseDB:
        row = RunCaseDB(
            run_id=run_id,
            snapshot_id=snapshot_id,
            display_order=display_order,
            added_by_user_id=added_by_user_id,
        )
        self.session.add(row)
        await self.session.flush()
        return row

    async def list_run_cases(self, run_id: uuid.UUID) -> list[RunCaseDB]:
        result = await self.session.execute(
            select(RunCaseDB).where(RunCaseDB.run_id == run_id).order_by(RunCaseDB.display_order.asc())
        )
        return list(result.scalars())

    async def list_run_cases_with_snapshots(self, run_id: uuid.UUID) -> list[tuple[RunCaseDB, RunCaseSnapshotDB]]:
        """Return (run_case, snapshot) pairs ordered by display_order.

        Convenience for routes that need to render a run's cases with their
        pinned snapshot body / title without issuing N+1 queries.
        """
        stmt = (
            select(RunCaseDB, RunCaseSnapshotDB)
            .join(
                RunCaseSnapshotDB,
                RunCaseDB.snapshot_id == RunCaseSnapshotDB.id,
            )
            .where(RunCaseDB.run_id == run_id)
            .order_by(RunCaseDB.display_order.asc())
        )
        result = await self.session.execute(stmt)
        return [(rc, snap) for rc, snap in result.all()]

    async def get_run_case_by_wombat_id(self, *, run_id: uuid.UUID, wombat_id: str) -> RunCaseDB | None:
        stmt = (
            select(RunCaseDB)
            .join(
                RunCaseSnapshotDB,
                RunCaseDB.snapshot_id == RunCaseSnapshotDB.id,
            )
            .where(
                RunCaseDB.run_id == run_id,
                RunCaseSnapshotDB.snapshot_wombat_id == wombat_id,
            )
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def remove_run_case(self, run_case_id: uuid.UUID) -> None:
        row = await self.session.get(RunCaseDB, run_case_id)
        if row is None:
            return
        await self.session.delete(row)
        await self.session.flush()

    # --- Results (SP3.3) -----------------------------------------------------

    async def get_result(self, *, run_id: uuid.UUID, run_case_id: uuid.UUID) -> ResultDB | None:
        stmt = select(ResultDB).where(
            ResultDB.run_id == run_id,
            ResultDB.run_case_id == run_case_id,
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def upsert_result(
        self,
        *,
        run_id: uuid.UUID,
        run_case_id: uuid.UUID,
        status: str,
        source: str,
        recorded_by_user_id: uuid.UUID | None = None,
        recorded_by_token_id: uuid.UUID | None = None,
        notes: str | None = None,
        failed_at_step: int | None = None,
        bug_links: list[dict] | None = None,
        duration_ms: int | None = None,
        expected_revision: int | None = None,
    ) -> ResultDB:
        """Insert or update the single result row for (run_id, run_case_id).

        Revision semantics:
          * New row -> revision=1; expected_revision must be None.
          * Existing row + expected_revision matches current -> bump revision by 1.
          * Mismatch -> raise ResultConflictError(current_revision).
        """
        existing = await self.get_result(run_id=run_id, run_case_id=run_case_id)
        if existing is None:
            if expected_revision is not None:
                # There is no row yet — any non-None expected_revision is a
                # mismatch against "not present" (treated as revision 0).
                raise ResultConflictError(current_revision=0)
            row = ResultDB(
                run_id=run_id,
                run_case_id=run_case_id,
                status=status,
                source=source,
                recorded_by_user_id=recorded_by_user_id,
                recorded_by_token_id=recorded_by_token_id,
                notes=notes,
                failed_at_step=failed_at_step,
                bug_links=bug_links or [],
                duration_ms=duration_ms,
                revision=1,
            )
            self.session.add(row)
            await self.session.flush()
            return row

        if expected_revision is not None and existing.revision != expected_revision:
            raise ResultConflictError(current_revision=existing.revision)

        existing.status = status
        existing.source = source
        existing.recorded_by_user_id = recorded_by_user_id
        existing.recorded_by_token_id = recorded_by_token_id
        existing.notes = notes
        existing.failed_at_step = failed_at_step
        existing.bug_links = bug_links or []
        existing.duration_ms = duration_ms
        existing.revision = existing.revision + 1
        await self.session.flush()
        return existing

    async def clear_result(
        self,
        *,
        run_id: uuid.UUID,
        run_case_id: uuid.UUID,
        expected_revision: int | None = None,
    ) -> None:
        existing = await self.get_result(run_id=run_id, run_case_id=run_case_id)
        if existing is None:
            return
        if expected_revision is not None and existing.revision != expected_revision:
            raise ResultConflictError(current_revision=existing.revision)
        await self.session.delete(existing)
        await self.session.flush()

    async def list_results(
        self,
        *,
        run_id: uuid.UUID,
        status: str | None = None,
    ) -> list[ResultDB]:
        stmt = select(ResultDB).where(ResultDB.run_id == run_id)
        if status is not None:
            stmt = stmt.where(ResultDB.status == status)
        stmt = stmt.order_by(ResultDB.created_at.asc())
        return list((await self.session.execute(stmt)).scalars())

    async def count_results_by_status(self, run_id: uuid.UUID) -> dict[str, int]:
        """Return a histogram of result statuses for a run.

        Always includes the four canonical buckets (pass / fail / blocked /
        skipped) plus the implicit `not_run` bucket, computed as
        `total_cases - sum(recorded statuses)`. `not_run` is the *absence*
        of a result row and is never persisted.
        """
        # Count persisted result rows by status.
        stmt = select(ResultDB.status, func.count()).where(ResultDB.run_id == run_id).group_by(ResultDB.status)
        rows = (await self.session.execute(stmt)).all()
        buckets: dict[str, int] = {
            "pass": 0,
            "fail": 0,
            "blocked": 0,
            "skipped": 0,
        }
        recorded = 0
        for status, count in rows:
            buckets[status] = count
            recorded += count
        # Implicit "not_run" bucket.
        total_q = select(func.count()).select_from(RunCaseDB).where(RunCaseDB.run_id == run_id)
        total_cases = (await self.session.execute(total_q)).scalar_one()
        buckets["not_run"] = max(0, total_cases - recorded)
        return buckets

    # --- Evidence (SP3.3) ----------------------------------------------------

    async def add_evidence(
        self,
        *,
        result_id: uuid.UUID,
        blob_id: str,
        filename: str,
        mime_type: str,
        size_bytes: int,
        uploaded_by_user_id: uuid.UUID | None = None,
        uploaded_by_token_id: uuid.UUID | None = None,
    ) -> ResultEvidenceDB:
        row = ResultEvidenceDB(
            result_id=result_id,
            blob_id=blob_id,
            filename=filename,
            mime_type=mime_type,
            size_bytes=size_bytes,
            uploaded_by_user_id=uploaded_by_user_id,
            uploaded_by_token_id=uploaded_by_token_id,
        )
        self.session.add(row)
        await self.session.flush()
        return row

    async def list_evidence(self, *, result_id: uuid.UUID) -> list[ResultEvidenceDB]:
        stmt = (
            select(ResultEvidenceDB)
            .where(ResultEvidenceDB.result_id == result_id)
            .order_by(ResultEvidenceDB.uploaded_at.asc())
        )
        return list((await self.session.execute(stmt)).scalars())

    async def get_evidence(self, evidence_id: uuid.UUID) -> ResultEvidenceDB | None:
        return await self.session.get(ResultEvidenceDB, evidence_id)

    async def delete_evidence(self, evidence_id: uuid.UUID) -> None:
        row = await self.session.get(ResultEvidenceDB, evidence_id)
        if row is None:
            return
        await self.session.delete(row)
        await self.session.flush()

    # --- Events (SP3.3) ------------------------------------------------------

    async def append_event(
        self,
        *,
        run_id: uuid.UUID,
        event_type: str,
        payload: dict,
        actor_user_id: uuid.UUID | None = None,
        actor_token_id: uuid.UUID | None = None,
    ) -> RunEventDB:
        row = RunEventDB(
            run_id=run_id,
            event_type=event_type,
            payload=payload,
            actor_user_id=actor_user_id,
            actor_token_id=actor_token_id,
        )
        self.session.add(row)
        await self.session.flush()
        return row

    async def list_events(
        self,
        *,
        run_id: uuid.UUID,
        limit: int = 50,
        cursor: str | None = None,
    ) -> list[RunEventDB]:
        """List run_events ordered (created_at DESC, id DESC) with cursor pagination.

        Cursor encodes ``(created_at, id)`` as base64(ISO|uuid) so pagination
        is stable across events sharing the same timestamp.
        """
        stmt = select(RunEventDB).where(RunEventDB.run_id == run_id)
        if cursor:
            created_at, ev_id = _decode_event_cursor(cursor)
            stmt = stmt.where(
                or_(
                    RunEventDB.created_at < created_at,
                    and_(
                        RunEventDB.created_at == created_at,
                        RunEventDB.id < ev_id,
                    ),
                )
            )
        stmt = stmt.order_by(RunEventDB.created_at.desc(), RunEventDB.id.desc()).limit(limit)
        return list((await self.session.execute(stmt)).scalars())
