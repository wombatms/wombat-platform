"""Generate JSON Schema files from Pydantic models."""

import json
from pathlib import Path

from wombat_core.models import Plan, SharedStep, Story, Suite, TestCase

SCHEMAS_DIR = Path(__file__).parent.parent / "schemas"

MODELS = {
    "testcase.schema.json": TestCase,
    "shared-step.schema.json": SharedStep,
    "plan.schema.json": Plan,
    "story.schema.json": Story,
    "suite.schema.json": Suite,
}


def main():
    SCHEMAS_DIR.mkdir(exist_ok=True)
    for filename, model in MODELS.items():
        schema = model.model_json_schema()
        path = SCHEMAS_DIR / filename
        with open(path, "w") as f:
            json.dump(schema, f, indent=2)
            f.write("\n")
        print(f"Generated {path}")


if __name__ == "__main__":
    main()
