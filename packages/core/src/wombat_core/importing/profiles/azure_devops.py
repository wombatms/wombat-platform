"""Azure DevOps Test Case export mapping profile.

Maps the columns produced by the Azure DevOps "Export to CSV" function on the
Test Plans → Test Cases grid.  Typical headers (and their Wombat targets):

  Azure DevOps column         Wombat TestCase field     Transform
  ─────────────────────────────────────────────────────────────────────
  ID                          id (used as wombat_id)    "TC-ADO-{n}" prefix
  Title / Work Item Title     title                     strip
  Area Path                   component                 area_path_last
  Assigned To                 owner                     strip
  Tags                        tags                      split_comma
  Description                 summary                   strip
  Priority                    priority                  normalised (1-4)
  State                       status                    normalised
  Test Type                   type                      lower

Notes
-----
* The ID column in ADO exports is a numeric work-item ID.  We prefix it with
  ``TC-ADO-`` so it forms a valid Wombat ID pattern.  If your project uses a
  different convention, supply a custom YAML mapping.
* "Area Path" is split on backslash to extract the last segment.
* Priority 1 → critical, 2 → high, 3 → medium, 4 → low.
* State "Active"/"Ready" → "active"; "Design"/"Draft" → "draft".
"""

from __future__ import annotations

from wombat_core.importing.mapping import ColumnMapping, MappingProfile


class _AzureIDTransform:
    """Handles the Azure DevOps numeric ID → Wombat ID transform inline."""


# Custom transform label used by the transformer.
_ADO_ID_TRANSFORM = "ado_id"


class AzureDevOpsProfile(MappingProfile):
    """Subclass of MappingProfile with Azure-specific ID transform."""

    def apply_transforms(self, col_map: ColumnMapping, value: str) -> object:
        if col_map.transform == "ado_id":
            v = value.strip()
            if v and not v.upper().startswith("TC-"):
                return f"TC-ADO-{v}"
            return v
        return super().apply_transforms(col_map, value)


AZURE_DEVOPS_PROFILE = AzureDevOpsProfile(
    name="azure_devops",
    columns=[
        ColumnMapping(source="ID", target="id", transform="ado_id"),
        ColumnMapping(source="Title", target="title", transform="strip"),
        ColumnMapping(source="Work Item Title", target="title", transform="strip"),
        ColumnMapping(source="Area Path", target="component", transform="area_path_last"),
        ColumnMapping(source="Assigned To", target="owner", transform="strip"),
        ColumnMapping(source="Tags", target="tags", transform="split_comma"),
        ColumnMapping(source="Description", target="summary", transform="strip"),
        ColumnMapping(source="Priority", target="priority", transform="strip"),
        ColumnMapping(source="State", target="status", transform="strip"),
        ColumnMapping(source="Test Type", target="type", transform="lower"),
    ],
    defaults={
        "status": "draft",
        "priority": "medium",
        "owner": "unassigned",
        "component": "general",
    },
)
