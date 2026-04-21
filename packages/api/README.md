# wombat-api

FastAPI application for the Wombat test management platform.

## Publisher setup (SP3.2)

The proposal publisher writes approved content changes directly to the project's Git repository. It requires a working clone of each project's repo on the host running the API server.

### `WOMBAT_GIT_WORKSPACE_ROOT`

Set this environment variable to a directory where the API process has read/write access. The publisher creates one subdirectory per project (named by project UUID). Default: `.wombat/workspace`.

```
WOMBAT_GIT_WORKSPACE_ROOT=/var/wombat/workspace
```

### Credentials flow

The API server process must be able to push to each project's `git_url` without a password prompt. Use one of:

- **SSH key**: place the private key in `~/.ssh/` for the user running the API (or set `GIT_SSH_COMMAND` to point at a specific key). Add the public key as a deploy key with write access on the remote.
- **HTTPS with a PAT**: store credentials in `~/.netrc` or use `git credential store`. On GitHub/Azure DevOps, issue a Personal Access Token with `Contents: write` scope.

The credentials must be configured before the first proposal is approved, because the publisher calls `git clone` lazily on the first publish for each project.

### Initial clone (optional)

The publisher will clone automatically on the first approval. To pre-populate or verify the clone:

```bash
git clone <project-git-url> /var/wombat/workspace/<project-uuid>
```

### Verify push rights

Before going to production, confirm the server can push:

```bash
git -C /var/wombat/workspace/<project-uuid> push --dry-run origin main
```

A `0` exit code confirms credentials and remote write access are correctly configured. Any non-zero result will surface as a `push_failed` error in the API response.
