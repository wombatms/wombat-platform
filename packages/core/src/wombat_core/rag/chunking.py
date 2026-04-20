"""Simple token-approximate chunking (whitespace tokens).

Not production-grade tokenization; good enough for MVP and matches how
sentence-transformers handles max_seq_length internally. Real tokenizer
can slot in later without changing the interface.
"""

from __future__ import annotations


def _tokens(s: str) -> list[str]:
    return s.split()


def should_chunk(text: str, *, max_tokens: int) -> bool:
    return len(_tokens(text)) > max_tokens


def chunk_text(
    text: str, *, max_tokens: int, overlap_tokens: int,
) -> list[str]:
    toks = _tokens(text)
    if len(toks) <= max_tokens:
        return [text]
    if overlap_tokens >= max_tokens:
        raise ValueError("overlap_tokens must be < max_tokens")
    out: list[str] = []
    step = max_tokens - overlap_tokens
    for start in range(0, len(toks), step):
        end = start + max_tokens
        piece = " ".join(toks[start:end])
        out.append(piece)
        if end >= len(toks):
            break
    return out


def chunk_markdown(
    md: str, *, max_tokens: int, overlap_tokens: int,
) -> list[str]:
    """Prefer splitting at heading boundaries; fall back to token-window."""
    # Split into heading-sections first.
    sections: list[str] = []
    buf: list[str] = []
    for line in md.splitlines(keepends=True):
        stripped = line.lstrip()
        if stripped.startswith("#") and buf:
            sections.append("".join(buf))
            buf = [line]
        else:
            buf.append(line)
    if buf:
        sections.append("".join(buf))

    out: list[str] = []
    current: list[str] = []
    current_tokens = 0
    for sec in sections:
        sec_tokens = len(_tokens(sec))
        if current_tokens + sec_tokens <= max_tokens:
            current.append(sec)
            current_tokens += sec_tokens
            continue
        # Flush current window.
        if current:
            out.append("".join(current))
        # If the section alone exceeds max_tokens, token-window it.
        if sec_tokens > max_tokens:
            out.extend(chunk_text(sec, max_tokens=max_tokens,
                                  overlap_tokens=overlap_tokens))
            current = []
            current_tokens = 0
        else:
            current = [sec]
            current_tokens = sec_tokens
    if current:
        out.append("".join(current))
    # Add overlap between adjacent chunks by prepending tail of previous.
    # Skip overlap prepend when the chunk already starts at a heading boundary
    # (i.e. heading-split chunks) — overlap only makes sense for text-window
    # splits within a single section.
    final: list[str] = []
    for i, c in enumerate(out):
        if i == 0 or overlap_tokens == 0:
            final.append(c)
            continue
        # If this chunk starts at a heading, don't prepend overlap.
        if c.lstrip().startswith("#"):
            final.append(c)
            continue
        prev_tail = " ".join(_tokens(out[i - 1])[-overlap_tokens:])
        final.append(prev_tail + " " + c)
    return final
