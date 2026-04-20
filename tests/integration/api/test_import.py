"""Import integration tests.

Scenarios:
- POST multipart upload to /imports/preview → returns parsed entities (count=3, no errors)
- POST to /imports/execute → returns a zip file (binary) with 3 Markdown files
- Inspect zip bytes: each entry is well-formed Markdown with frontmatter
- Viewer role → 403; editor → 200
"""

from __future__ import annotations

import io
import zipfile

import openpyxl
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession


def _make_xlsx_bytes(rows: list[list], headers: list[str]) -> bytes:
    """Create an in-memory XLSX file and return its bytes."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(headers)
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


_HEADERS = ["id", "title", "component", "owner", "tags", "summary", "priority", "status"]
_ROWS = [
    ["TC-IMP-001", "Login test", "auth", "qa-team", "smoke,regression", "Basic login flow", "high", "active"],
    ["TC-IMP-002", "Refund test", "payments", "qa-team", "regression", "Refund eligibility", "critical", "active"],
    ["TC-IMP-003", "Cart test", "checkout", "qa-team", "", "Add to cart", "medium", "draft"],
]


@pytest.mark.asyncio
async def test_import_preview_returns_entities(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """POST /imports/preview with a 3-row XLSX returns count=3, no errors."""
    project, slug = seeded_project
    # editor already has role from `users` fixture

    xlsx_bytes = _make_xlsx_bytes(_ROWS, _HEADERS)
    editor_token = users["editor"]["token"]

    resp = await httpx_client.post(
        f"/api/projects/{slug}/imports/preview",
        files={
            "file": (
                "test_import.xlsx",
                xlsx_bytes,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
        data={"profile": "default"},
        headers={"Authorization": f"Bearer {editor_token}"},
    )
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    body = resp.json()
    assert body["parsed"] == 3, f"Expected parsed=3, got {body['parsed']}"
    assert body["skipped"] == 0, f"Expected skipped=0, got {body['skipped']}"
    assert body["errors"] == [], f"Expected no errors, got {body['errors']}"
    assert len(body["entities"]) == 3


@pytest.mark.asyncio
async def test_import_execute_returns_zip(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """POST /imports/execute returns a valid zip with 3 Markdown files."""
    project, slug = seeded_project
    xlsx_bytes = _make_xlsx_bytes(_ROWS, _HEADERS)
    editor_token = users["editor"]["token"]

    resp = await httpx_client.post(
        f"/api/projects/{slug}/imports/execute",
        files={
            "file": (
                "test_import.xlsx",
                xlsx_bytes,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
        data={"profile": "default"},
        headers={"Authorization": f"Bearer {editor_token}"},
    )
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    assert resp.headers.get("content-type") == "application/zip"
    assert resp.headers.get("x-import-parsed") == "3"


@pytest.mark.asyncio
async def test_import_execute_zip_contains_markdown(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """Each entry in the zip is well-formed Markdown with frontmatter."""
    project, slug = seeded_project
    xlsx_bytes = _make_xlsx_bytes(_ROWS, _HEADERS)
    editor_token = users["editor"]["token"]

    resp = await httpx_client.post(
        f"/api/projects/{slug}/imports/execute",
        files={
            "file": (
                "test_import.xlsx",
                xlsx_bytes,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
        data={"profile": "default"},
        headers={"Authorization": f"Bearer {editor_token}"},
    )
    assert resp.status_code == 200

    # Parse the zip
    zip_bytes = io.BytesIO(resp.content)
    with zipfile.ZipFile(zip_bytes, "r") as zf:
        names = zf.namelist()
        assert len(names) == 3, f"Expected 3 files in zip, got {len(names)}: {names}"

        for name in names:
            assert name.endswith(".md"), f"Expected .md file, got {name}"
            content = zf.read(name).decode("utf-8")
            # Verify YAML frontmatter delimiter
            assert content.startswith("---"), f"Missing frontmatter in {name}: {content[:100]}"
            # Find the closing --- delimiter
            lines = content.split("\n")
            close_idx = None
            for i, line in enumerate(lines[1:], 1):
                if line.strip() == "---":
                    close_idx = i
                    break
            assert close_idx is not None, f"No closing '---' in frontmatter of {name}"
            # Verify the id field is present in frontmatter
            frontmatter_text = "\n".join(lines[1:close_idx])
            assert "id:" in frontmatter_text, f"No 'id:' in frontmatter of {name}"


@pytest.mark.asyncio
async def test_import_viewer_forbidden(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """A viewer cannot use the import endpoints (requires editor+)."""
    project, slug = seeded_project
    xlsx_bytes = _make_xlsx_bytes(_ROWS[:1], _HEADERS)
    viewer_token = users["viewer"]["token"]

    # Preview
    resp_preview = await httpx_client.post(
        f"/api/projects/{slug}/imports/preview",
        files={"file": ("test.xlsx", xlsx_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={"profile": "default"},
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert resp_preview.status_code == 403

    # Execute
    resp_execute = await httpx_client.post(
        f"/api/projects/{slug}/imports/execute",
        files={"file": ("test.xlsx", xlsx_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={"profile": "default"},
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert resp_execute.status_code == 403


@pytest.mark.asyncio
async def test_import_csv_preview(
    httpx_client: AsyncClient,
    db_session: AsyncSession,
    users,
    seeded_project,
):
    """CSV upload to /imports/preview also works."""
    import csv

    project, slug = seeded_project
    editor_token = users["editor"]["token"]

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(_HEADERS)
    for row in _ROWS:
        writer.writerow(row)
    csv_bytes = buf.getvalue().encode("utf-8")

    resp = await httpx_client.post(
        f"/api/projects/{slug}/imports/preview",
        files={"file": ("test.csv", csv_bytes, "text/csv")},
        data={"profile": "default"},
        headers={"Authorization": f"Bearer {editor_token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["parsed"] == 3
