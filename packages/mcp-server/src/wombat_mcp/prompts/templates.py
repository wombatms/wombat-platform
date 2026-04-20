"""Curated prompt templates for common Wombat workflows.

Each entry in PROMPTS defines:
- ``description`` — one-line summary shown to the LLM host
- ``arguments``   — list of named placeholders the host can pass
- ``template``    — the full prompt text with {PLACEHOLDER} substitutions
"""

from __future__ import annotations

PROMPTS: dict[str, dict] = {
    "create-regression-tests": {
        "description": (
            "Generate formal regression test cases for a feature or bug fix, "
            "avoiding duplication with existing tests."
        ),
        "arguments": [
            {
                "name": "feature",
                "description": "Short description of the feature or bug fix to cover.",
                "required": True,
            },
            {
                "name": "project",
                "description": "Wombat project slug (used to search for existing tests).",
                "required": False,
            },
            {
                "name": "component",
                "description": "Component or module name (e.g. 'auth', 'checkout').",
                "required": False,
            },
        ],
        "template": """\
You are a senior QA engineer authoring regression tests for the Wombat test management system.

Feature / change to cover: {feature}
Component: {component}
Project: {project}

## Step 1 — Discover existing tests
Use the `api:search_content` tool (or `local:search` if offline) to search for existing
test cases related to this feature. Avoid creating duplicates.

Example:
  api:search_content(project="{project}", query="{feature}", kinds=["testcase"], top_k=10)

## Step 2 — Identify gaps
Review the search results. Identify scenarios NOT yet covered by existing tests:
- Happy path
- Edge cases (empty input, boundary values, max limits)
- Error / negative paths
- Regression scenarios for known past bugs

## Step 3 — Draft new test cases
For each gap, draft a formal test case in Wombat Markdown format.
Use `wombat://schemas/testcase` to see the required schema.
Use `wombat://templates/testcase` as a starting template.

Each test case must include:
- A unique WombatID (TC-{component}-NNN format)
- Preconditions
- Numbered steps
- Expected results
- Tags including "regression"

## Step 4 — Lint and validate
Use `local:lint` and `local:validate` to check the new files before committing.

Begin by searching for existing tests now.
""",
    },

    "review-test-changes": {
        "description": (
            "Review a set of changed test case files and provide structured feedback "
            "on coverage gaps, quality issues, and compliance with Wombat conventions."
        ),
        "arguments": [
            {
                "name": "changed_files",
                "description": "Space-separated list of changed .md file paths.",
                "required": True,
            },
            {
                "name": "project",
                "description": "Wombat project slug.",
                "required": False,
            },
        ],
        "template": """\
You are a QA lead reviewing test case changes before merge.

Changed files: {changed_files}
Project: {project}

## Review checklist

### 1. Parse and validate each file
For each file in the changed set:
  local:parse(path="<file>")
  local:validate(path="<file>")
  local:lint(path="<file>")

Fix any parse errors or lint warnings before proceeding.

### 2. Check for duplicates
For each changed test case, use `api:find_related_testcases` with `draft_text`
set to the test's title + steps body to check for near-duplicate existing tests.

### 3. Coverage assessment
For each story referenced by these tests:
  api:stories.get(project="{project}", wombat_id="<story_id>")

Check whether the linked test cases cover:
- All acceptance criteria
- Both positive and negative paths
- Any edge cases mentioned in the story

### 4. Structural quality
Verify each test case:
- Has clear, unambiguous steps (no passive voice)
- Has an expected result for every step
- Preconditions are complete
- Tags are accurate (component, priority, test_type)

### 5. Summary
Provide a structured review with:
- Files reviewed
- Issues found (with file path and line guidance)
- Missing coverage
- Approval recommendation (approve / request changes)

Begin reviewing now.
""",
    },

    "suggest-missing-tests": {
        "description": (
            "Analyse a story or feature specification and suggest test cases that "
            "are missing from the current test suite."
        ),
        "arguments": [
            {
                "name": "story_id",
                "description": "WombatID of the story to analyse (e.g. STORY-AUTH-001).",
                "required": False,
            },
            {
                "name": "feature_description",
                "description": "Free-text description of the feature to analyse.",
                "required": False,
            },
            {
                "name": "project",
                "description": "Wombat project slug.",
                "required": False,
            },
        ],
        "template": """\
You are a QA strategist identifying test coverage gaps.

Story: {story_id}
Feature: {feature_description}
Project: {project}

## Analysis workflow

### 1. Gather context
If a story_id is provided:
  api:stories.get(project="{project}", wombat_id="{story_id}")

If a feature description is provided, search for related content:
  api:search_content(project="{project}", query="{feature_description}", top_k=15)

### 2. Map acceptance criteria to tests
List the acceptance criteria from the story. For each criterion, check whether
an existing test case covers it (search by criterion text using api:search_content).

### 3. Risk-based gap analysis
For gaps identified, assess risk:
- HIGH: untested paths that could cause user-visible failures or data loss
- MEDIUM: edge cases with moderate user impact
- LOW: cosmetic or rarely-reached paths

### 4. Suggest new test cases
For each gap, provide:
- Suggested title
- Component / owner
- Brief outline: preconditions, key steps, expected result
- Risk level and rationale

Format suggestions as a numbered list, ready to be turned into formal test cases
using the `create-regression-tests` prompt.

Begin the analysis now.
""",
    },

    "convert-to-formal-cases": {
        "description": (
            "Convert informal test notes, exploratory session logs, or acceptance "
            "criteria bullet points into formal Wombat test cases."
        ),
        "arguments": [
            {
                "name": "informal_notes",
                "description": "The informal test notes or acceptance criteria to convert.",
                "required": True,
            },
            {
                "name": "component",
                "description": "Target component for the new test cases.",
                "required": False,
            },
            {
                "name": "owner",
                "description": "Test case owner (default from config).",
                "required": False,
            },
            {
                "name": "project",
                "description": "Wombat project slug (used for duplicate checking).",
                "required": False,
            },
        ],
        "template": """\
You are a QA engineer formalising informal test notes into structured Wombat test cases.

Informal notes:
---
{informal_notes}
---

Target component: {component}
Owner: {owner}
Project: {project}

## Conversion process

### 1. Load the schema and template
  wombat://schemas/testcase   — review required fields and types
  wombat://templates/testcase — use as the Markdown skeleton

### 2. Check for existing tests
Before creating each case, search for similar existing tests:
  api:search_content(project="{project}", query="<derived query>", kinds=["testcase"], top_k=5)

Or use draft-text similarity check:
  api:find_related_testcases(project="{project}", draft_text="<case title + steps>", top_k=5)

### 3. Convert each note
For each distinct test scenario identified in the notes:
- Assign a WombatID: TC-{component}-NNN
- Write clear, numbered steps (active voice, imperative mood)
- Specify concrete expected results
- Fill in all required frontmatter fields (owner, priority, status=draft, type)
- Add relevant tags

### 4. Output format
Return all converted test cases as complete Markdown blocks, one per case,
separated by `---`. Each block must be valid Wombat Markdown that could be
written directly to a .md file.

### 5. Validate
Pipe the output through `local:validate` and `local:lint` after saving the files.

Begin conversion now.
""",
    },

    "summarize-run-results": {
        "description": (
            "Fetch a test run and produce a concise human-readable summary with "
            "pass/fail breakdown, notable failures, and coverage implications."
        ),
        "arguments": [
            {
                "name": "run_id",
                "description": "UUID of the test run to summarise.",
                "required": True,
            },
            {
                "name": "project",
                "description": "Wombat project slug.",
                "required": True,
            },
        ],
        "template": """\
You are a QA reporting assistant summarising a test run.

Run ID: {run_id}
Project: {project}

## Summary workflow

### 1. Fetch the run
  api:runs.get(project="{project}", run_id="{run_id}")

Note the run title, plan, environment, status, and the summary metrics
(total, passed, failed, skipped, blocked).

### 2. Analyse failures
For each failed test case in the run:
  api:testcases.get(project="{project}", wombat_id="<wombat_id>")

Group failures by:
- Component
- Failure pattern (look for common error messages or step numbers)
- Severity (is this a P0/P1 test?)

### 3. Coverage check
Identify which stories or plan are linked to this run and note whether
the failures create any coverage risk:
  api:search_content(project="{project}", query="<component> failures", top_k=5)

### 4. Write the summary
Produce a structured report with:
- **Run overview**: title, environment, start/end time, overall status
- **Results breakdown**: passed / failed / skipped / blocked counts and percentages
- **Top failures**: top 5 failures with test ID, title, component
- **Risk assessment**: components or user stories at risk
- **Recommended actions**: immediate actions, investigations, re-run candidates
- **Trend note** (if prior runs available): pass rate compared to previous run

Keep the summary concise — suitable for a Slack post or PR comment.

Begin by fetching the run data now.
""",
    },
}


def render_prompt(name: str, arguments: dict[str, str]) -> str:
    """Render a prompt template, substituting *arguments* for placeholders.

    Unknown placeholders are left as-is (``{KEY}``).
    """
    meta = PROMPTS[name]
    template: str = meta["template"]
    # Fill in provided arguments; leave missing ones as literal {KEY}
    for key, value in (arguments or {}).items():
        template = template.replace(f"{{{key}}}", value)
    return template
