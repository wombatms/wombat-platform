"""Schema and template resources for the wombat:// URI scheme.

Schemas are generated from Pydantic model JSON schemas for each entity kind.
Templates are read from the templates/ directory under the .wombat root (or a
bundled fallback if no config is found).
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import mcp.types as types

# Canonical kind names → Pydantic model import path
_KINDS = ["testcase", "shared_step", "plan", "story", "suite"]

_KIND_DISPLAY = {
    "testcase": "Test Case",
    "shared_step": "Shared Step",
    "plan": "Test Plan",
    "story": "User Story",
    "suite": "Test Suite",
}


# ---------------------------------------------------------------------------
# Schema resources
# ---------------------------------------------------------------------------

def list_schema_resources() -> list[types.Resource]:
    return [
        types.Resource(
            uri=f"wombat://schemas/{kind}",
            name=f"{_KIND_DISPLAY[kind]} schema",
            description=f"JSON Schema for the {_KIND_DISPLAY[kind]} entity kind.",
            mimeType="application/schema+json",
        )
        for kind in _KINDS
    ]


def read_schema_resource(kind: str) -> str:
    """Return the JSON Schema string for the given *kind*."""
    if kind not in _KINDS:
        raise ValueError(f"Unknown kind {kind!r}. Valid kinds: {_KINDS}")
    model_cls = _get_model_class(kind)
    schema = model_cls.model_json_schema()
    return json.dumps(schema, indent=2)


def _get_model_class(kind: str):  # noqa: ANN202
    from wombat_core.models import Plan, SharedStep, Story, Suite, TestCase

    mapping = {
        "testcase": TestCase,
        "shared_step": SharedStep,
        "plan": Plan,
        "story": Story,
        "suite": Suite,
    }
    return mapping[kind]


# ---------------------------------------------------------------------------
# Template resources
# ---------------------------------------------------------------------------

# Minimal built-in templates used when no .wombat/templates/ directory exists.
_BUILTIN_TEMPLATES: dict[str, str] = {
    "testcase": """\
---
id: TC-{COMPONENT}-{NUMBER}
title: "{TITLE}"
component: "{COMPONENT}"
owner: "{OWNER}"
priority: medium
status: draft
type: functional
tags: []
shared_steps: []
---

## Preconditions

- {PRECONDITION}

## Steps

1. {STEP_1}

## Expected Result

{EXPECTED_RESULT}
""",
    "shared_step": """\
---
id: SS-{NAME}
title: "{TITLE}"
owner: "{OWNER}"
tags: []
---

## Steps

1. {STEP_1}
""",
    "plan": """\
---
id: PLAN-{NAME}
title: "{TITLE}"
owner: "{OWNER}"
suites: []
---
""",
    "story": """\
---
id: STORY-{NAME}
title: "{TITLE}"
owner: "{OWNER}"
linked_tests: []
---

## Description

{DESCRIPTION}

## Acceptance Criteria

- {CRITERION}
""",
    "suite": """\
---
id: SUITE-{NAME}
title: "{TITLE}"
owner: "{OWNER}"
component: "{COMPONENT}"
cases: []
---
""",
}


def list_template_resources() -> list[types.Resource]:
    templates = _discover_templates()
    return [
        types.Resource(
            uri=f"wombat://templates/{kind}",
            name=f"{_KIND_DISPLAY.get(kind, kind)} template",
            description=f"Markdown template for authoring a {_KIND_DISPLAY.get(kind, kind)}.",
            mimeType="text/markdown",
        )
        for kind in templates
    ]


def read_template_resource(kind: str) -> str:
    """Return the Markdown template for *kind*."""
    templates = _discover_templates()
    if kind not in templates:
        raise ValueError(f"No template found for kind {kind!r}")
    return templates[kind]


def _discover_templates() -> dict[str, str]:
    """Discover templates from the .wombat/templates/ directory or builtins."""
    repo_path = Path(os.environ.get("WOMBAT_REPO_PATH", "."))

    # Try to load the config to find the templates directory
    try:
        from wombat_core.config.loader import load_config
        config = load_config(repo_path)
        if config.config_path is not None:
            templates_dir = config.config_path.parent / config.templates.directory
            if templates_dir.is_dir():
                return _load_templates_from_dir(templates_dir)
    except Exception:
        pass

    # Fallback to built-in templates
    return dict(_BUILTIN_TEMPLATES)


def _load_templates_from_dir(directory: Path) -> dict[str, str]:
    """Load .md template files from *directory*, keyed by stem."""
    templates: dict[str, str] = dict(_BUILTIN_TEMPLATES)
    for f in sorted(directory.glob("*.md")):
        templates[f.stem] = f.read_text(encoding="utf-8")
    return templates
