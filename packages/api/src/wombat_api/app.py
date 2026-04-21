"""FastAPI application factory."""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from wombat_api.config import get_config

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    cfg = get_config()
    app = FastAPI(
        title="Wombat API",
        version="0.1.0",
        description="Agent-friendly test case management API",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    _assert_embedder_dim_matches()
    _register_routes(app)
    _register_error_handlers(app)
    return app


def _assert_embedder_dim_matches() -> None:
    """Fail-fast if configured embedder dim != EMBED_DIM.

    Lazy-imports wombat_core.rag.embedders so that importing app.py at module
    level never requires the embedder package to be present.  The embedder
    module is delivered by Task 14; until then a clear RuntimeError is raised
    with remediation text when create_app() is actually called.
    """
    try:
        from wombat_core.rag.embedders import load_embedder  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "wombat_core.rag.embedders is not available. "
            "Ensure Task 14 (embedder module) has been completed and "
            "'wombat-core' is installed with the rag extras. "
            f"Original error: {exc}"
        ) from exc

    from wombat_api.database.models import EMBED_DIM

    emb = load_embedder()
    if emb.dim != EMBED_DIM:
        raise RuntimeError(
            f"Embedder '{emb.name}' reports dim={emb.dim} but EMBED_DIM={EMBED_DIM}. "
            "Run `wombat sync --reindex-all` after updating WOMBAT_EMBED_DIM."
        )


def _register_routes(app: FastAPI) -> None:
    from wombat_api.routes import (  # noqa: F401
        audit,
        auth,
        content,
        imports,
        plans,
        projects,
        proposals,
        runs,
        search,
        shared_steps,
        stories,
        suites,
        sync,
        testcases,
    )

    app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
    app.include_router(projects.router, prefix="/api/projects", tags=["projects"])
    app.include_router(search.router, prefix="/api/projects", tags=["search"])
    app.include_router(content.router, prefix="/api/projects", tags=["content"])
    app.include_router(testcases.router, prefix="/api/projects", tags=["content"])
    app.include_router(shared_steps.router, prefix="/api/projects", tags=["content"])
    app.include_router(plans.router, prefix="/api/projects", tags=["content"])
    app.include_router(stories.router, prefix="/api/projects", tags=["content"])
    app.include_router(suites.router, prefix="/api/projects", tags=["content"])
    app.include_router(runs.router, prefix="/api/projects", tags=["runs"])
    app.include_router(sync.router, prefix="/api/projects", tags=["sync"])
    app.include_router(imports.router, prefix="/api/projects", tags=["imports"])
    app.include_router(audit.router, prefix="/api/projects", tags=["audit"])
    app.include_router(proposals.router)  # prefix already set in router definition


def _register_error_handlers(app: FastAPI) -> None:
    """Register consistent error envelopes for all exceptions.

    Error shape: {"error": {"code": "...", "message": "...", "field": null, "hint": null}}
    See prior SP2 spec §10.
    """

    @app.exception_handler(Exception)
    async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled exception on %s %s", request.method, request.url)
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "internal_error",
                    "message": "An unexpected error occurred.",
                    "field": None,
                    "hint": None,
                }
            },
        )

    from fastapi import HTTPException

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail
        if isinstance(detail, dict):
            # Route handlers raise HTTPException(detail={"code": ..., "message": ...})
            # Pass the dict through as-is so callers receive the typed error envelope.
            return JSONResponse(status_code=exc.status_code, content={"error": detail})
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": {
                    "code": f"http_{exc.status_code}",
                    "message": str(detail),
                    "field": None,
                    "hint": None,
                }
            },
        )

    from fastapi.exceptions import RequestValidationError

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        errors = exc.errors()
        first = errors[0] if errors else {}
        field = ".".join(str(loc) for loc in first.get("loc", [])) or None
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "validation_error",
                    "message": first.get("msg", "Validation error"),
                    "field": field,
                    "hint": f"{len(errors)} error(s) total" if len(errors) > 1 else None,
                }
            },
        )


def _make_app_lazy() -> FastAPI:
    """Module-level app instance for uvicorn.

    Deferred until after Task 14 (embedder) is available.  Until then the
    import itself is safe; only actually starting the server will fail.
    """
    try:
        return create_app()
    except RuntimeError as exc:
        if "wombat_core.rag.embedders" in str(exc):
            # Embedder not yet installed — return a minimal app so that
            # `import wombat_api.app` works at import time.  Starting the
            # server will still raise once the ASGI lifespan runs.
            logger.debug("Embedder not available at import time; deferring: %s", exc)
            _stub = FastAPI(title="Wombat API (embedder pending)")
            return _stub
        raise


app = _make_app_lazy()
