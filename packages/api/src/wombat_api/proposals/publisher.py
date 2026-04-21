"""Publisher: commit + push an approved proposal to Git, update DB, reindex."""

from __future__ import annotations

import logging
import subprocess
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.auth.dependencies import Principal
from wombat_api.config import get_config
from wombat_api.database.models import ProjectDB, ProposalDB, UserDB
from wombat_api.database.repository import Repository
from wombat_api.proposals.frontmatter import mutate_review_block
from wombat_api.proposals.mutex import project_publish_lock

logger = logging.getLogger(__name__)


@dataclass
class PublishResult:
    published_sha: str
    commit_message: str


class ConflictError(Exception):
    def __init__(self, current_sha: str):
        self.current_sha = current_sha
        super().__init__(f"conflict: base_revision stale; current HEAD={current_sha}")


class PushRejectedError(Exception):
    def __init__(self, stderr: str):
        self.stderr = stderr
        super().__init__(f"git push rejected: {stderr}")


async def publish_proposal(
    session: AsyncSession,
    *,
    project: ProjectDB,
    proposal: ProposalDB,
    approver: Principal,
    author_user: UserDB,
    action: str,  # "approve" | "direct_publish"
    comment: str | None,
) -> PublishResult:
    """Run the 11-step publish procedure from spec §7.3.

    Caller holds the DB transaction. On error, caller rolls back; this function
    raises ConflictError / PushRejectedError for the router to translate.
    """
    repo = Repository(session)
    cfg = get_config()

    async with project_publish_lock(session, project.id):
        # Step 1-2: ensure working clone, fetch + reset to origin/main.
        clone_root = Path(cfg.git_workspace_root) / str(project.id)
        _ensure_clone(clone_root, project)
        _fetch_and_reset(clone_root)

        # Step 3-4: conflict detection.
        if (
            not _is_ancestor(clone_root, proposal.base_revision, "origin/main")
            and _path_touched_since(clone_root, proposal.base_revision, proposal.source_path)
        ):
            current_sha = _current_sha(clone_root)
            raise ConflictError(current_sha=current_sha)

        # Step 5: mutate frontmatter review block.
        mutated_body = mutate_review_block(
            proposal.proposed_body,
            approver_display_name=approver.user.display_name,
            approver_email=approver.user.email,
            action=action,
        )

        # Step 6: write file (or git rm for delete proposals).
        file_path = clone_root / proposal.source_path
        if proposal.proposal_action == "delete":
            subprocess.run(
                ["git", "-C", str(clone_root), "rm", proposal.source_path],
                check=True,
            )
        else:
            file_path.parent.mkdir(parents=True, exist_ok=True)
            _write_canonical_file(file_path, mutated_body)
            subprocess.run(
                ["git", "-C", str(clone_root), "add", proposal.source_path],
                check=True,
            )

        # Step 7: build commit message with Git trailers.
        author_ident = f"{author_user.display_name} <{author_user.email}>"
        trailers = [f"Proposal-id: {proposal.id}"]
        if action == "approve":
            trailers.insert(
                0,
                f"Approved-by: {approver.user.display_name} <{approver.user.email}>",
            )
        else:
            trailers.insert(
                0,
                f"Published-directly-by: {approver.user.display_name} <{approver.user.email}>",
            )
            if approver.token and approver.token.purpose:
                trailers.append(f"Purpose: {approver.token.purpose}")
        message = f"{proposal.proposed_title}\n\n" + "\n".join(trailers)

        # Step 8: git commit.
        subprocess.run(
            [
                "git",
                "-C",
                str(clone_root),
                "commit",
                f"--author={author_ident}",
                "-m",
                message,
            ],
            check=True,
        )

        # Step 9: git push; roll back local commit on failure.
        push = subprocess.run(
            ["git", "-C", str(clone_root), "push", "origin", "main"],
            capture_output=True,
            text=True,
        )
        if push.returncode != 0:
            subprocess.run(
                ["git", "-C", str(clone_root), "reset", "--hard", "origin/main"],
                check=True,
            )
            raise PushRejectedError(stderr=push.stderr)

        published_sha = _current_sha(clone_root)

        # Step 10: upsert content row.
        await repo.upsert_content_from_proposal(
            project_id=project.id,
            proposal=proposal,
            published_sha=published_sha,
            mutated_body=mutated_body,
        )

        # Step 11: best-effort reindex; flag stale on failure.
        try:
            await repo.reindex_content(
                project_id=project.id,
                source_path=proposal.source_path,
            )
        except Exception as exc:
            logger.warning("reindex failed after publish of %s: %s", proposal.id, exc)
            await repo.mark_content_stale_embedding(
                project_id=project.id,
                source_path=proposal.source_path,
            )

        return PublishResult(published_sha=published_sha, commit_message=message)


# ---- Git helpers --------------------------------------------------------


def _ensure_clone(clone_root: Path, project: ProjectDB) -> None:
    """Clone the project's git repository if the working clone doesn't exist yet."""
    if clone_root.exists():
        return
    if not project.git_url:
        raise ValueError(
            f"Project {project.id} ({project.slug}) has no git_url configured. "
            "Set WOMBAT_GIT_WORKSPACE_ROOT and ensure the project has a git_url."
        )
    clone_root.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "clone", project.git_url, str(clone_root)], check=True)


def _fetch_and_reset(clone_root: Path) -> None:
    subprocess.run(["git", "-C", str(clone_root), "fetch", "origin"], check=True)
    subprocess.run(
        ["git", "-C", str(clone_root), "reset", "--hard", "origin/main"],
        check=True,
    )


def _is_ancestor(clone_root: Path, base: str, head: str) -> bool:
    """Return True if `base` is an ancestor of `head` (i.e. no new commits)."""
    r = subprocess.run(
        ["git", "-C", str(clone_root), "merge-base", "--is-ancestor", base, head]
    )
    return r.returncode == 0


def _path_touched_since(clone_root: Path, base: str, path: str) -> bool:
    """Return True if `path` has commits between `base` and origin/main."""
    r = subprocess.run(
        ["git", "-C", str(clone_root), "log", f"{base}..origin/main", "--", path],
        capture_output=True,
        text=True,
    )
    return bool(r.stdout.strip())


def _current_sha(clone_root: Path) -> str:
    return subprocess.run(
        ["git", "-C", str(clone_root), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()


def _write_canonical_file(path: Path, body: dict) -> None:
    """Write the body dict ({"frontmatter": {...}, "markdown": "..."}) to path.

    Uses wombat_core's YAML dumper for the frontmatter block, then appends
    the markdown body verbatim.
    """
    import yaml

    fm = body.get("frontmatter") or {}
    md = body.get("markdown") or ""

    content = "---\n"
    content += yaml.dump(fm, sort_keys=False, allow_unicode=True, default_flow_style=False)
    content += "---\n"
    if md:
        content += md
        if not md.endswith("\n"):
            content += "\n"

    path.write_text(content, encoding="utf-8")
