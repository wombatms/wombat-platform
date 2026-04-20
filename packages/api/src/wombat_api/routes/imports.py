"""Import routes — XLSX/CSV upload and server-side import.

Endpoints
---------
- POST /{slug}/imports/upload   — upload file, returns raw parse result
- POST /{slug}/imports/preview  — upload + apply mapping, returns entity list
- POST /{slug}/imports/execute  — upload + apply mapping + write Markdown zip

All endpoints require the ``editor`` role.

Implementation note
-------------------
Server-side import for MVP produces a downloadable zip of Markdown files.
The files are generated in memory; no DB writes happen at this stage.
To persist: the user downloads the zip, commits the Markdown files to their
Git repo, then runs ``wombat sync`` to index them.
"""

from __future__ import annotations

import io
import tempfile
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.database.engine import get_session
from wombat_api.database.models import ProjectDB
from wombat_api.rbac.middleware import require_role
from wombat_api.rbac.models import Role

router = APIRouter()


@router.post("/{project_slug}/imports/upload")
async def upload_import(
    project_slug: str,
    file: UploadFile = File(..., description="XLSX or CSV file to import."),
    profile: str = Form("default", description="Mapping profile name."),
    project: ProjectDB = Depends(require_role(Role.editor)),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Upload an XLSX or CSV file and return a raw parse summary.

    Returns the column headers and first 5 rows for inspection.
    Does not apply any mapping or write any entities.
    """
    from wombat_core.importing.parser import parse_csv, parse_xlsx

    with tempfile.NamedTemporaryFile(suffix=_safe_suffix(file.filename), delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = Path(tmp.name)

    try:
        suffix = tmp_path.suffix.lower()
        if suffix in (".xlsx", ".xlsm", ".xltx", ".xltm"):
            headers, rows = parse_xlsx(tmp_path)
        elif suffix == ".csv":
            headers, rows = parse_csv(tmp_path)
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type '{suffix}'. Supported: .xlsx, .csv",
            )
    finally:
        tmp_path.unlink(missing_ok=True)

    preview_rows = [{h: (row[i] if i < len(row) else None) for i, h in enumerate(headers)} for row in rows[:5]]

    return {
        "filename": file.filename,
        "profile": profile,
        "headers": headers,
        "total_rows": len(rows),
        "preview_rows": preview_rows,
    }


@router.post("/{project_slug}/imports/preview")
async def preview_import(
    project_slug: str,
    file: UploadFile = File(..., description="XLSX or CSV file to import."),
    profile: str = Form("default", description="Mapping profile name."),
    project: ProjectDB = Depends(require_role(Role.editor)),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Upload and apply mapping — returns parsed entity summary without writing.

    Returns:
        ``{"parsed": N, "skipped": N, "errors": [...], "entities": [...first 10...]}``
    """
    result = await _parse_upload(file, profile)
    return {
        "filename": file.filename,
        "profile": profile,
        "parsed": len(result.entities),
        "skipped": len(result.skipped),
        "errors": result.errors,
        "entities": [e.model_dump(mode="json") for e in result.entities[:10]],
    }


@router.post("/{project_slug}/imports/execute")
async def execute_import(
    project_slug: str,
    file: UploadFile = File(..., description="XLSX or CSV file to import."),
    profile: str = Form("default", description="Mapping profile name."),
    project: ProjectDB = Depends(require_role(Role.editor)),
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Upload, apply mapping, and produce a zip of Markdown files.

    Returns a ``application/zip`` response containing one ``.md`` file per
    parsed entity.  The user downloads the zip, commits the files to their
    Git repo, and runs ``wombat sync`` to index them.

    On error (e.g. all rows invalid), returns a 422 with an error summary.
    """
    from wombat_core.parsing.writer import write_entity

    result = await _parse_upload(file, profile)

    if not result.entities:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "No valid entities could be parsed.",
                "errors": result.errors,
            },
        )

    # Build an in-memory zip.
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for entity in result.entities:
            # write_entity writes to a file; we capture it via tmp.
            with tempfile.NamedTemporaryFile(suffix=".md", delete=False) as tmp:
                tmp_path = Path(tmp.name)
            try:
                write_entity(entity, tmp_path)
                content = tmp_path.read_text(encoding="utf-8")
                zf.writestr(f"testcases/{entity.id}.md", content)
            finally:
                tmp_path.unlink(missing_ok=True)

    buf.seek(0)
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="import_{project_slug}.zip"',
            "X-Import-Parsed": str(len(result.entities)),
            "X-Import-Skipped": str(len(result.skipped)),
            "X-Import-Errors": str(len(result.errors)),
        },
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _parse_upload(file: UploadFile, profile_name: str):
    """Save upload to a temp file, parse it, return ImportResult."""
    from wombat_core.importing import parse_file

    content = await file.read()
    suffix = _safe_suffix(file.filename)

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = Path(tmp.name)

    try:
        result = parse_file(tmp_path, profile_name=profile_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        tmp_path.unlink(missing_ok=True)

    return result


def _safe_suffix(filename: str | None) -> str:
    if not filename:
        return ".tmp"
    suffix = Path(filename).suffix.lower()
    if suffix in (".xlsx", ".xlsm", ".xltx", ".xltm", ".csv"):
        return suffix
    return ".tmp"
