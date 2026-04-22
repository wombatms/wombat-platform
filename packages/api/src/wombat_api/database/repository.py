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
    SyncLogDB,
    UserDB,
    UserProjectRoleDB,
)
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

    async def ensure_default_environment(
        self, *, project_id: uuid.UUID, user_id: uuid.UUID
    ) -> EnvironmentDB:
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
    ) -> APITokenDB:
        row = APITokenDB(
            user_id=user_id,
            name=name,
            scopes=scopes,
            token_hash=token_hash,
            expires_at=expires_at,
            publish_direct=publish_direct,
            purpose=purpose,
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
