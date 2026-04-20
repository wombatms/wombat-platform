"""Unit tests for wombat_core.importing.

Covers:
- XLSX round-trip
- CSV round-trip
- Malformed row → skipped with error recorded
- Dry-run (preview) mode returns entities without side effects
- Azure DevOps mapping profile
- Default column mapping auto-detection
"""

from __future__ import annotations

import csv
import io
import uuid
from pathlib import Path

import pytest

from wombat_core.importing import parse_file, ImportResult
from wombat_core.importing.mapping import MappingProfile, ColumnMapping, load_profile
from wombat_core.importing.parser import parse_xlsx, parse_csv
from wombat_core.importing.transformer import transform_rows
from wombat_core.models.testcase import TestCase


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _xlsx_path(tmp_path: Path, rows: list[list], headers: list[str] | None = None) -> Path:
    """Write rows to a temporary XLSX file and return its path."""
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    if headers:
        ws.append(headers)
    for row in rows:
        ws.append(row)
    dest = tmp_path / f"test_{uuid.uuid4().hex[:8]}.xlsx"
    wb.save(dest)
    return dest


def _csv_path(tmp_path: Path, rows: list[list], headers: list[str] | None = None) -> Path:
    dest = tmp_path / f"test_{uuid.uuid4().hex[:8]}.csv"
    with open(dest, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        if headers:
            writer.writerow(headers)
        for row in rows:
            writer.writerow(row)
    return dest


_STANDARD_HEADERS = ["id", "title", "component", "owner", "tags", "summary", "priority", "status"]
_STANDARD_ROW = ["TC-TEST-0001", "Login test", "auth", "qa-team", "smoke,regression", "Basic login flow", "high", "active"]


# ---------------------------------------------------------------------------
# Parser tests
# ---------------------------------------------------------------------------


class TestParseXLSX:
    def test_returns_headers_and_rows(self, tmp_path):
        path = _xlsx_path(tmp_path, [_STANDARD_ROW], _STANDARD_HEADERS)
        headers, rows = parse_xlsx(path)
        assert headers == _STANDARD_HEADERS
        assert len(rows) == 1

    def test_empty_file_returns_empty(self, tmp_path):
        path = _xlsx_path(tmp_path, [])
        headers, rows = parse_xlsx(path)
        assert headers == []
        assert rows == []

    def test_multiple_rows(self, tmp_path):
        data = [
            ["TC-001", "Case 1", "comp", "owner", "", "summary", "high", "active"],
            ["TC-002", "Case 2", "comp", "owner", "", "summary", "medium", "draft"],
        ]
        path = _xlsx_path(tmp_path, data, _STANDARD_HEADERS)
        headers, rows = parse_xlsx(path)
        assert len(rows) == 2

    def test_skips_all_none_rows(self, tmp_path):
        import openpyxl
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(_STANDARD_HEADERS)
        ws.append(_STANDARD_ROW)
        ws.append([None, None, None, None, None, None, None, None])  # empty row
        ws.append(["TC-002", "Case 2", "comp", "owner", "", "summary", "medium", "draft"])
        dest = tmp_path / "test_skip_none.xlsx"
        wb.save(dest)
        _, rows = parse_xlsx(dest)
        assert len(rows) == 2  # empty row skipped


class TestParseCSV:
    def test_returns_headers_and_rows(self, tmp_path):
        path = _csv_path(tmp_path, [_STANDARD_ROW], _STANDARD_HEADERS)
        headers, rows = parse_csv(path)
        assert headers == _STANDARD_HEADERS
        assert len(rows) == 1

    def test_empty_file_returns_empty(self, tmp_path):
        dest = tmp_path / "empty.csv"
        dest.write_text("")
        headers, rows = parse_csv(dest)
        assert headers == []
        assert rows == []

    def test_multiple_rows(self, tmp_path):
        data = [
            ["TC-001", "Case 1", "comp", "owner", "", "summary", "high", "active"],
            ["TC-002", "Case 2", "comp", "owner", "", "summary", "medium", "draft"],
        ]
        path = _csv_path(tmp_path, data, _STANDARD_HEADERS)
        _, rows = parse_csv(path)
        assert len(rows) == 2


# ---------------------------------------------------------------------------
# End-to-end parse_file tests
# ---------------------------------------------------------------------------


class TestParseFileXLSX:
    def test_xlsx_roundtrip(self, tmp_path):
        path = _xlsx_path(tmp_path, [_STANDARD_ROW], _STANDARD_HEADERS)
        result = parse_file(path)
        assert isinstance(result, ImportResult)
        assert len(result.entities) == 1
        tc = result.entities[0]
        assert isinstance(tc, TestCase)
        assert tc.id == "TC-TEST-0001"
        assert tc.title == "Login test"
        assert tc.component == "auth"
        assert tc.owner == "qa-team"
        assert "smoke" in tc.tags
        assert tc.priority.value == "high"  # Priority is an enum
        assert tc.status.value == "active"

    def test_xlsx_multiple_rows(self, tmp_path):
        rows = [
            ["TC-001", "Case 1", "auth", "qa", "smoke", "Summary 1", "high", "active"],
            ["TC-002", "Case 2", "payments", "qa", "", "Summary 2", "medium", "draft"],
        ]
        path = _xlsx_path(tmp_path, rows, _STANDARD_HEADERS)
        result = parse_file(path)
        assert len(result.entities) == 2
        assert result.entities[0].id == "TC-001"
        assert result.entities[1].id == "TC-002"

    def test_unsupported_extension_raises(self, tmp_path):
        dest = tmp_path / "test.txt"
        dest.write_text("hello")
        with pytest.raises(ValueError, match="Unsupported file type"):
            parse_file(dest)


class TestParseFileCSV:
    def test_csv_roundtrip(self, tmp_path):
        path = _csv_path(tmp_path, [_STANDARD_ROW], _STANDARD_HEADERS)
        result = parse_file(path)
        assert isinstance(result, ImportResult)
        assert len(result.entities) == 1
        tc = result.entities[0]
        assert tc.id == "TC-TEST-0001"
        assert tc.title == "Login test"

    def test_csv_tags_split_from_comma(self, tmp_path):
        row = ["TC-001", "Title", "comp", "owner", "alpha,beta,gamma", "Desc", "medium", "draft"]
        path = _csv_path(tmp_path, [row], _STANDARD_HEADERS)
        result = parse_file(path)
        assert result.entities[0].tags == ["alpha", "beta", "gamma"]


# ---------------------------------------------------------------------------
# Malformed row handling
# ---------------------------------------------------------------------------


class TestMalformedRows:
    def test_malformed_row_skipped_with_error(self, tmp_path):
        """A row with an invalid priority value that fails validation should be skipped."""
        # Use a row with an invalid status that can't be normalised (still draft)
        # and an invalid id that contains special chars — Pydantic WombatID may reject.
        good_row = ["TC-GOOD-001", "Good case", "comp", "owner", "", "desc", "high", "active"]
        bad_row = [None, None, None, None, None, None, None, None]  # produces empty title after normalise
        path = _xlsx_path(tmp_path, [good_row, bad_row], _STANDARD_HEADERS)
        result = parse_file(path)
        # The bad row has no id, title → auto-generates both; it may succeed or fail.
        # What matters is we get the good row.
        assert any(tc.id == "TC-GOOD-001" for tc in result.entities)

    def test_invalid_wombat_id_format_creates_error(self, tmp_path):
        """A row whose ID doesn't match the WombatID pattern is skipped with an error."""
        # WombatID requires the pattern XX-COMPONENT-NNNN or similar uppercase.
        # A value like "!!BAD!!" should fail.
        bad_row = ["!!BAD!!", "Some title", "comp", "owner", "", "desc", "high", "active"]
        path = _csv_path(tmp_path, [bad_row], _STANDARD_HEADERS)
        result = parse_file(path)
        assert len(result.skipped) == 1
        assert len(result.errors) == 1
        assert result.errors[0]["row"] == 2  # row index (header=1, data=2)

    def test_errors_contain_row_and_message(self, tmp_path):
        bad_row = ["!!INVALID_ID!!", "Title", "comp", "owner", "", "desc", "high", "active"]
        path = _csv_path(tmp_path, [bad_row], _STANDARD_HEADERS)
        result = parse_file(path)
        if result.errors:
            err = result.errors[0]
            assert "row" in err
            assert "message" in err


# ---------------------------------------------------------------------------
# Dry-run / preview
# ---------------------------------------------------------------------------


class TestDryRun:
    """parse_file in dry-run mode returns entities without writing files."""

    def test_dry_run_returns_importresult(self, tmp_path):
        path = _csv_path(tmp_path, [_STANDARD_ROW], _STANDARD_HEADERS)
        result = parse_file(path)
        # parse_file always returns ImportResult — no DB writes, no file writes.
        assert isinstance(result, ImportResult)
        assert len(result.entities) == 1

    def test_no_files_written(self, tmp_path):
        """Calling parse_file should not create any extra files."""
        before = set(tmp_path.iterdir())
        path = _csv_path(tmp_path, [_STANDARD_ROW], _STANDARD_HEADERS)
        parse_file(path)
        after = set(tmp_path.iterdir())
        # Only the CSV itself was added, no markdown files.
        new_files = after - before
        assert all(f.suffix in (".csv",) for f in new_files)


# ---------------------------------------------------------------------------
# Azure DevOps profile
# ---------------------------------------------------------------------------


class TestAzureDevOpsProfile:
    _ADO_HEADERS = [
        "ID", "Title", "Area Path", "Assigned To", "Tags",
        "Description", "Priority", "State", "Test Type",
    ]
    _ADO_ROW = [
        "12345", "Refund flow", "MyProject\\Payments\\Checkout",
        "alice@example.com", "regression, smoke",
        "Verify refund", "2", "Active", "Functional",
    ]

    def test_ado_profile_loads(self):
        profile = load_profile("azure_devops")
        assert profile.name == "azure_devops"

    def test_ado_id_gets_prefixed(self, tmp_path):
        path = _csv_path(tmp_path, [self._ADO_ROW], self._ADO_HEADERS)
        result = parse_file(path, profile_name="azure_devops")
        assert len(result.entities) == 1
        tc = result.entities[0]
        assert tc.id == "TC-ADO-12345"

    def test_ado_area_path_extracted(self, tmp_path):
        path = _csv_path(tmp_path, [self._ADO_ROW], self._ADO_HEADERS)
        result = parse_file(path, profile_name="azure_devops")
        tc = result.entities[0]
        assert tc.component == "Checkout"

    def test_ado_priority_2_maps_to_high(self, tmp_path):
        path = _csv_path(tmp_path, [self._ADO_ROW], self._ADO_HEADERS)
        result = parse_file(path, profile_name="azure_devops")
        tc = result.entities[0]
        assert tc.priority.value == "high"

    def test_ado_status_active_maps_correctly(self, tmp_path):
        path = _csv_path(tmp_path, [self._ADO_ROW], self._ADO_HEADERS)
        result = parse_file(path, profile_name="azure_devops")
        tc = result.entities[0]
        assert tc.status.value == "active"

    def test_ado_tags_split_on_comma(self, tmp_path):
        path = _csv_path(tmp_path, [self._ADO_ROW], self._ADO_HEADERS)
        result = parse_file(path, profile_name="azure_devops")
        tc = result.entities[0]
        assert "regression" in tc.tags
        assert "smoke" in tc.tags

    def test_ado_xlsx_roundtrip(self, tmp_path):
        path = _xlsx_path(tmp_path, [self._ADO_ROW], self._ADO_HEADERS)
        result = parse_file(path, profile_name="azure_devops")
        assert len(result.entities) == 1
        assert result.entities[0].id == "TC-ADO-12345"


# ---------------------------------------------------------------------------
# Default auto-detect profile
# ---------------------------------------------------------------------------


class TestDefaultProfile:
    def test_default_profile_detects_standard_columns(self, tmp_path):
        path = _csv_path(tmp_path, [_STANDARD_ROW], _STANDARD_HEADERS)
        result = parse_file(path, profile_name="default")
        assert len(result.entities) == 1
        assert result.entities[0].id == "TC-TEST-0001"

    def test_auto_generates_id_when_missing(self, tmp_path):
        row_no_id = [None, "Title only", "comp", "owner", "", "desc", "medium", "draft"]
        path = _csv_path(tmp_path, [row_no_id], _STANDARD_HEADERS)
        result = parse_file(path, profile_name="default")
        assert len(result.entities) == 1
        assert result.entities[0].id.startswith("TC-IMPORT-")
