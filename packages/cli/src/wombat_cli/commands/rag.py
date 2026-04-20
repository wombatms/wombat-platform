"""wombat rag — RAG / retrieval subcommands.

Currently provides:
  wombat rag preview "<query>" [--project X] [--server URL] [--token T]
                               [--mode hybrid|semantic|keyword] [--top-k N]
                               [--kind testcase] [--kind doc] ...
"""

from __future__ import annotations

import os
import sys
from typing import Annotated

import typer

rag_app = typer.Typer(
    name="rag",
    help="RAG retrieval utilities.",
    no_args_is_help=True,
)


@rag_app.command("preview")
def rag_preview(
    query: Annotated[
        str,
        typer.Argument(help="Search query string."),
    ],
    project: Annotated[
        str,
        typer.Option("--project", "-p", help="Project slug."),
    ] = "",
    server: Annotated[
        str | None,
        typer.Option(
            "--server",
            help="Wombat API base URL (required unless WOMBAT_DATABASE_URL is set).",
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
    mode: Annotated[
        str,
        typer.Option("--mode", help="Search mode: hybrid | semantic | keyword."),
    ] = "hybrid",
    top_k: Annotated[
        int,
        typer.Option("--top-k", "-k", help="Number of results to return."),
    ] = 10,
    kinds: Annotated[
        list[str] | None,
        typer.Option("--kind", help="Filter by content kind (repeatable)."),
    ] = None,
) -> None:
    """Preview RAG retrieval results for a query.

    In **server mode** (``--server`` given), calls
    ``POST /api/projects/{slug}/search`` and prints a rich table of results.

    In **local mode** (no ``--server``), requires ``WOMBAT_DATABASE_URL`` to
    point to a Postgres instance with a populated content table.  If not set,
    the command exits with an error message.
    """
    if server:
        _server_preview(
            server=server,
            project_slug=project,
            token=token or "",
            query=query,
            mode=mode,
            top_k=top_k,
            kinds=kinds,
        )
    else:
        _local_preview(
            query=query,
            project_slug=project,
            mode=mode,
            top_k=top_k,
            kinds=kinds,
        )


def _server_preview(
    server: str,
    project_slug: str,
    token: str,
    query: str,
    mode: str,
    top_k: int,
    kinds: list[str] | None,
) -> None:
    if not project_slug:
        typer.echo("Error: --project is required in server mode.", err=True)
        raise typer.Exit(1)

    import httpx

    base = server.rstrip("/")
    url = f"{base}/api/projects/{project_slug}/search"

    try:
        with httpx.Client(timeout=60) as client:
            r = client.post(
                url,
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "query": query,
                    "kinds": kinds,
                    "top_k": top_k,
                    "mode": mode,
                    "include_chunks": True,
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
    hits = data.get("hits", [])
    _print_hits_table(query=query, hits=hits, mode=mode)


def _local_preview(
    query: str,
    project_slug: str,
    mode: str,
    top_k: int,
    kinds: list[str] | None,
) -> None:
    db_url = os.environ.get("WOMBAT_DATABASE_URL", "")
    if not db_url or "postgresql" not in db_url:
        typer.echo(
            "Postgres DB required for rag preview.\n"
            "Set WOMBAT_DATABASE_URL to a postgresql+asyncpg:// URL and retry,\n"
            "or use --server to call a running Wombat API instead.",
            err=True,
        )
        raise typer.Exit(1)

    if not project_slug:
        typer.echo("Error: --project is required for local rag preview.", err=True)
        raise typer.Exit(1)

    import asyncio

    async def _run() -> list[dict]:
        from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
        from wombat_api.database.repository import Repository
        from wombat_api.search.hybrid import hybrid_search
        from wombat_core.rag.embedders import load_embedder

        engine = create_async_engine(db_url)
        async_session = async_sessionmaker(engine, expire_on_commit=False)

        embedder = load_embedder()
        vecs = await embedder.embed_batch([query])
        q_vec = vecs[0]

        async with async_session() as session:
            # Resolve project slug → project_id
            from sqlalchemy import select
            from wombat_api.database.models import ProjectDB

            proj = (
                await session.execute(
                    select(ProjectDB).where(ProjectDB.slug == project_slug)
                )
            ).scalar_one_or_none()
            if proj is None:
                typer.echo(f"Error: project '{project_slug}' not found.", err=True)
                raise typer.Exit(1)

            return await hybrid_search(
                session,
                project_id=proj.id,
                query=query,
                query_embedding=q_vec,
                kinds=kinds,
                top_k=top_k,
                mode=mode,
                include_chunks=True,
            )

    hits = asyncio.run(_run())
    _print_hits_table(query=query, hits=hits, mode=mode)


def _print_hits_table(query: str, hits: list[dict], mode: str) -> None:
    try:
        from rich.table import Table
        from rich.console import Console

        console = Console()
        table = Table(title=f'RAG preview — "{query}" (mode={mode})')
        table.add_column("score", style="cyan", no_wrap=True)
        table.add_column("kind", style="magenta")
        table.add_column("wombat_id / title")
        table.add_column("source path", style="dim")

        for h in hits:
            label = h.get("wombat_id") or h.get("title", "")
            path = (h.get("source") or {}).get("path", "")
            table.add_row(
                f"{h.get('score', 0):.4f}",
                h.get("kind", ""),
                label,
                path,
            )

        console.print(table)
        console.print(f"\n{len(hits)} hit(s) returned.")
    except ImportError:
        # Fallback if rich is unavailable
        typer.echo(f'RAG preview — "{query}" (mode={mode})')
        for h in hits:
            label = h.get("wombat_id") or h.get("title", "")
            path = (h.get("source") or {}).get("path", "")
            typer.echo(f"  {h.get('score', 0):.4f}  {h.get('kind', '')}  {label}  {path}")
        typer.echo(f"{len(hits)} hit(s).")
