"""wombat sync — sync Git-canonical content into the Wombat API / RAG index."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Annotated

import typer


def sync_command(
    project: Annotated[
        str,
        typer.Option("--project", "-p", help="Project slug (required in API mode)."),
    ] = "",
    server: Annotated[
        str | None,
        typer.Option(
            "--server",
            help="Wombat API base URL. If omitted, local smoke-test mode is used.",
            envvar="WOMBAT_API_URL",
        ),
    ] = None,
    token: Annotated[
        str | None,
        typer.Option(
            "--token",
            help="Bearer token for API authentication.",
            envvar="WOMBAT_API_TOKEN",
        ),
    ] = None,
    test_repo_path: Annotated[
        Path,
        typer.Option(
            "--repo",
            help="Path to the Git repo containing entity Markdown files.",
        ),
    ] = Path("."),
) -> None:
    """Sync Git-canonical content into the Wombat DB and refresh the RAG index.

    In **API mode** (``--server`` given), POSTs to ``POST /api/projects/{slug}/sync``
    with the provided bearer token.  Progress is printed to stdout.

    In **local mode** (no ``--server``), the command is a smoke-test only: it
    loads the source resolver and reports what files would be indexed without
    writing to any database.  A full local mode (local SQLite + embedder) is
    deferred to a future release.
    """
    from wombat_core.config.loader import load_config

    cfg = load_config(test_repo_path.resolve())
    rag = cfg.rag_sources  # may be None

    if server:
        _api_sync(
            server=server,
            project_slug=project,
            token=token or "",
            test_repo_path=test_repo_path,
            rag=rag,
        )
    else:
        _local_smoke(test_repo_path=test_repo_path, rag=rag)


def _api_sync(
    server: str,
    project_slug: str,
    token: str,
    test_repo_path: Path,
    rag,
) -> None:
    """POST to the sync endpoint and print the summary."""
    if not project_slug:
        typer.echo("Error: --project is required in API mode.", err=True)
        raise typer.Exit(1)

    import httpx

    app_repos = []
    docs_folder = None
    if rag is not None:
        app_repos = [a.model_dump() for a in rag.app_repos]
        docs_folder = rag.docs_folder

    base = server.rstrip("/")
    url = f"{base}/api/projects/{project_slug}/sync"
    typer.echo(f"Syncing project '{project_slug}' via {url} …")

    try:
        with httpx.Client(timeout=3600) as client:
            r = client.post(
                url,
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "test_repo_path": str(test_repo_path.resolve()),
                    "app_repos": app_repos,
                    "docs_folder": docs_folder,
                },
            )
            r.raise_for_status()
    except httpx.HTTPStatusError as exc:
        typer.echo(f"Error: HTTP {exc.response.status_code} — {exc.response.text}", err=True)
        raise typer.Exit(1)
    except httpx.RequestError as exc:
        typer.echo(f"Error: request failed — {exc}", err=True)
        raise typer.Exit(1)

    data = r.json()
    typer.echo(
        f"Sync complete: total={data.get('total', '?')}  "
        f"embedded={data.get('embedded', '?')}  "
        f"skipped={data.get('skipped', '?')}  "
        f"errors={data.get('errors', '?')}"
    )


def _local_smoke(test_repo_path: Path, rag) -> None:
    """Walk sources and report what would be indexed (no DB writes).

    Full local-mode DB writes are deferred.  This is useful for checking that
    paths resolve correctly before pushing to a server.
    """
    from wombat_core.config.models import AppRepoSource, RagSourcesConfig
    from wombat_core.rag.sources import SourceResolver

    app_repos = []
    docs_folder = None
    chunk_size = 500
    chunk_overlap = 50
    if rag is not None:
        app_repos = rag.app_repos
        docs_folder = rag.docs_folder
        chunk_size = rag.chunk_size_tokens
        chunk_overlap = rag.chunk_overlap_tokens

    resolver = SourceResolver(
        test_repo_root=test_repo_path.resolve(),
        sources_root=Path(".wombat/sources"),
        config=RagSourcesConfig(
            app_repos=app_repos,
            docs_folder=docs_folder,
            chunk_size_tokens=chunk_size,
            chunk_overlap_tokens=chunk_overlap,
        ),
    )

    files = list(resolver.iter_files())
    typer.echo(f"[local smoke] Found {len(files)} file(s) to index.")
    for rf in files:
        typer.echo(f"  {rf.source_repo}:{rf.source_path}")
    typer.echo(
        "\nNote: local mode is a smoke-test only (no DB writes). "
        "Use --server to sync against a running Wombat API."
    )
