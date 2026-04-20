"""Repository layer: typed async methods over Content + operational tables."""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import UTC, datetime

from sqlalchemy import and_, func, or_, select
from sqlalchemy import delete as sa_delete
from sqlalchemy import update as sa_update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.database.models import (
    APITokenDB,
    AuditLogDB,
    Content,
    ContentChunk,
    ExecutionResultDB,
    ProjectDB,
    RunDB,
    SyncLogDB,
    UserDB,
    UserProjectRoleDB,
)
from wombat_api.schemas.common import (
    ExecutionResultCreate,
    ProjectCreate,
    RunCreate,
    RunSummary,
    UserCreate,
)


def canonical_json(body: dict) -> str:
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def content_hash_for(body: dict) -> str:
    return hashlib.sha256(canonical_json(body).encode("utf-8")).hexdigest()


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
    ) -> APITokenDB:
        row = APITokenDB(
            user_id=user_id,
            name=name,
            scopes=scopes,
            token_hash=token_hash,
            expires_at=expires_at,
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

    # --- Runs / Results -------------------------------------------------------

    async def create_run(
        self,
        project_id: uuid.UUID,
        run: RunCreate,
        triggered_by: str,
    ) -> RunDB:
        row = RunDB(
            project_id=project_id,
            title=run.title,
            plan_wombat_id=run.plan_wombat_id,
            environment=run.environment,
            assignees=run.assignees,
            source=run.source,
            triggered_by=triggered_by,
        )
        self.session.add(row)
        await self.session.flush()
        return row

    async def get_run(self, run_id: uuid.UUID) -> RunDB | None:
        return await self.session.get(RunDB, run_id)

    async def list_runs(
        self,
        project_id: uuid.UUID,
        limit: int,
        offset: int,
    ) -> list[RunDB]:
        q = (
            select(RunDB)
            .where(RunDB.project_id == project_id)
            .order_by(RunDB.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return list((await self.session.execute(q)).scalars())

    async def update_run_status(self, run_id: uuid.UUID, status: str) -> None:
        await self.session.execute(sa_update(RunDB).where(RunDB.id == run_id).values(status=status))

    async def bulk_add_results(
        self,
        run_id: uuid.UUID,
        results: list[ExecutionResultCreate],
        resolve_content_id,  # callable(wombat_id) -> UUID
    ) -> int:
        now = datetime.now(UTC)
        created = 0
        for r in results:
            cid = await resolve_content_id(r.testcase_id)
            if cid is None:
                continue
            self.session.add(
                ExecutionResultDB(
                    run_id=run_id,
                    content_id=cid,
                    wombat_testcase_id=r.testcase_id,
                    status=r.status,
                    duration_ms=r.duration_ms,
                    environment=r.environment,
                    automated=r.automated,
                    notes=r.notes,
                    bug_references=r.bug_references,
                    evidence_references=r.evidence_references,
                    raw_payload=r.raw_payload,
                    executed_at=now,
                )
            )
            created += 1
        return created

    async def get_run_summary(self, run_id: uuid.UUID) -> RunSummary:
        q = (
            select(ExecutionResultDB.status, func.count(), func.sum(ExecutionResultDB.duration_ms))
            .where(ExecutionResultDB.run_id == run_id)
            .group_by(ExecutionResultDB.status)
        )
        rows = (await self.session.execute(q)).all()
        bucket = {"pass": 0, "fail": 0, "block": 0, "skip": 0, "error": 0}
        total_duration = 0
        for status, count, dur in rows:
            bucket[status] = count
            if dur is not None:
                total_duration += int(dur)
        total = sum(bucket.values())
        return RunSummary(
            run_id=run_id,
            total=total,
            passed=bucket["pass"],
            failed=bucket["fail"],
            blocked=bucket["block"],
            skipped=bucket["skip"],
            errored=bucket["error"],
            duration_ms=total_duration or None,
        )

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
