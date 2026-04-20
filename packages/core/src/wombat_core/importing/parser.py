"""XLSX and CSV parsers.

Both return ``(headers, rows)`` where:
- ``headers`` is a list of column header strings (first row).
- ``rows`` is a list of value lists, one per data row.

Empty/all-None rows are skipped.
"""

from __future__ import annotations

import csv
from pathlib import Path


def parse_xlsx(path: Path) -> tuple[list[str], list[list]]:
    """Parse an XLSX file using openpyxl.

    Returns ``(headers, rows)`` where headers are the values of the first
    non-empty row and rows are subsequent data rows.
    """
    import openpyxl

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    if ws is None:
        return [], []

    all_rows = list(ws.iter_rows(values_only=True))
    wb.close()

    if not all_rows:
        return [], []

    # First row is headers.
    headers = [str(h).strip() if h is not None else "" for h in all_rows[0]]

    # Remaining rows are data; skip all-None rows.
    rows: list[list] = []
    for row in all_rows[1:]:
        if any(cell is not None for cell in row):
            rows.append(list(row))

    return headers, rows


def parse_csv(path: Path) -> tuple[list[str], list[list]]:
    """Parse a CSV file using stdlib csv.

    Returns ``(headers, rows)``.  Sniffs the dialect from the first 4 KB.
    """
    with open(path, newline="", encoding="utf-8-sig") as fh:
        sample = fh.read(4096)
        fh.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample)
        except csv.Error:
            dialect = csv.excel  # fallback to default

        reader = csv.reader(fh, dialect)
        all_rows = list(reader)

    if not all_rows:
        return [], []

    headers = [h.strip() for h in all_rows[0]]
    rows: list[list] = []
    for row in all_rows[1:]:
        if any(cell.strip() for cell in row):
            rows.append(list(row))

    return headers, rows
