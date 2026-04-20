"""Tests for SQLAlchemy database models."""

import uuid
from datetime import UTC, datetime

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


class TestModelsExist:
    def test_project_db(self):
        p = ProjectDB(
            id=uuid.uuid4(),
            slug="test-project",
            name="Test Project",
            taxonomy_components=["auth"],
            taxonomy_environments=["staging"],
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        assert p.slug == "test-project"
        assert p.__tablename__ == "projects"

    def test_user_db(self):
        u = UserDB(
            id=uuid.uuid4(),
            email="test@example.com",
            hashed_password="hashed",
            display_name="Test User",
            is_active=True,
            created_at=datetime.now(UTC),
        )
        assert u.email == "test@example.com"
        assert u.__tablename__ == "users"

    def test_content_row_testcase_kind(self):
        c = Content(
            id=uuid.uuid4(),
            project_id=uuid.uuid4(),
            kind="testcase",
            wombat_id="tc-auth-login-0001",
            title="Login with valid credentials",
            tags=["auth", "smoke"],
            body={"summary": "...", "steps": []},
            source_repo="test-repo",
            source_path="testcases/tc-auth-login-0001.md",
            source_revision="abc123",
            content_hash="deadbeef",
            synced_at=datetime.now(UTC),
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        assert c.kind == "testcase"
        assert c.__tablename__ == "content"

    def test_content_row_doc_kind(self):
        c = Content(
            id=uuid.uuid4(),
            project_id=uuid.uuid4(),
            kind="doc",
            wombat_id=None,
            title="Refund Policy ADR",
            tags=["adr", "payments"],
            body={"text": "..."},
            source_repo="app-repo:my-service",
            source_path="docs/ADR-012.md",
            source_revision="f00ba7",
            content_hash="cafebabe",
            synced_at=datetime.now(UTC),
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        assert c.wombat_id is None
        assert c.source_repo == "app-repo:my-service"

    def test_content_chunk(self):
        parent_id = uuid.uuid4()
        ch = ContentChunk(
            id=uuid.uuid4(),
            content_id=parent_id,
            chunk_index=0,
            text="chunk text",
        )
        assert ch.content_id == parent_id
        assert ch.__tablename__ == "content_chunks"

    def test_run_db(self):
        r = RunDB(
            id=uuid.uuid4(),
            project_id=uuid.uuid4(),
            title="Test Run",
            triggered_by="test@example.com",
            source="api",
            status="pending",
            assignees=[],
            created_at=datetime.now(UTC),
        )
        assert r.status == "pending"
        assert r.__tablename__ == "runs"

    def test_execution_result_db(self):
        er = ExecutionResultDB(
            id=uuid.uuid4(),
            run_id=uuid.uuid4(),
            content_id=uuid.uuid4(),
            wombat_testcase_id="tc-auth-login-0001",
            status="pass",
            automated=True,
            executed_at=datetime.now(UTC),
            created_at=datetime.now(UTC),
        )
        assert er.status == "pass"
        assert er.__tablename__ == "execution_results"

    def test_all_tablenames_unique(self):
        models = [
            ProjectDB,
            UserDB,
            APITokenDB,
            UserProjectRoleDB,
            Content,
            ContentChunk,
            RunDB,
            ExecutionResultDB,
            SyncLogDB,
            AuditLogDB,
        ]
        names = [m.__tablename__ for m in models]
        assert len(names) == len(set(names)), f"Duplicate: {names}"
