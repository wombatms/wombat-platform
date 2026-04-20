"""PDF text extraction using pypdf."""

from __future__ import annotations

from pathlib import Path


def extract_pdf_text(path: Path | str) -> str:
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    parts: list[str] = []
    for page in reader.pages:
        txt = page.extract_text() or ""
        parts.append(txt.strip())
    return "\n\n".join(p for p in parts if p)
