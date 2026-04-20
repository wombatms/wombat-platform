"""Tests for chunking long-form content."""

from wombat_core.rag.chunking import chunk_text, chunk_markdown, should_chunk


def test_short_text_not_chunked():
    assert not should_chunk("a short line", max_tokens=500)


def test_long_text_chunked():
    long = "word " * 2000
    assert should_chunk(long, max_tokens=500)


def test_chunk_text_respects_max_tokens():
    text = "word " * 1200
    chunks = chunk_text(text, max_tokens=500, overlap_tokens=50)
    assert len(chunks) >= 3
    for c in chunks:
        # Tokens approximated as whitespace splits.
        assert len(c.split()) <= 550  # some slack for overlap


def test_chunks_overlap():
    text = " ".join(str(i) for i in range(1000))  # tokens are "0","1",...,"999"
    chunks = chunk_text(text, max_tokens=200, overlap_tokens=30)
    # Check at least some tail-of-chunk[i] equals head-of-chunk[i+1]
    tail = chunks[0].split()[-30:]
    head = chunks[1].split()[:30]
    assert tail == head


def test_chunk_markdown_prefers_heading_splits():
    md = (
        "# Title\n"
        + "intro paragraph " * 200 + "\n\n"
        + "## Section A\n"
        + "content A " * 200 + "\n\n"
        + "## Section B\n"
        + "content B " * 200 + "\n"
    )
    chunks = chunk_markdown(md, max_tokens=400, overlap_tokens=40)
    # Expect at least one chunk boundary to be at a heading.
    assert any(c.lstrip().startswith("## ") for c in chunks[1:])
