"""Tests for PDF text extraction."""

from pathlib import Path

from wombat_core.rag.pdf import extract_pdf_text


def test_extract_simple_pdf(tmp_path: Path):
    pdf = tmp_path / "hello.pdf"
    _write_minimal_pdf(pdf, ["Hello Wombat", "Second page text"])
    text = extract_pdf_text(pdf)
    assert "Hello Wombat" in text
    assert "Second page text" in text


def _write_minimal_pdf(path: Path, pages: list[str]) -> None:
    # Use reportlab if available; else inline a minimal PDF.
    from reportlab.pdfgen import canvas

    c = canvas.Canvas(str(path))
    for p in pages:
        c.drawString(72, 720, p)
        c.showPage()
    c.save()
