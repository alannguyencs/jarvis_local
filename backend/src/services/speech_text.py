"""Turn Claude's answer into text that sounds right when read aloud.

The voice prompt already asks for plain sentences; this is the backstop for
when Markdown slips through anyway (code, links, bullets, tables, emoji).
"""

import re

_FENCED_CODE = re.compile(r"```.*?(```|\Z)", re.S)
_INLINE_CODE = re.compile(r"`([^`]*)`")
_IMAGE = re.compile(r"!\[([^\]]*)\]\([^)]*\)")
_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_URL = re.compile(r"https?://\S+")
_HEADING = re.compile(r"^\s{0,3}#{1,6}\s+", re.M)
_QUOTE = re.compile(r"^\s*>\s?", re.M)
_BULLET = re.compile(r"^\s*(?:[-*+•]|\d+[.)])\s+", re.M)
_TABLE_RULE = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$", re.M)
_HR = re.compile(r"^\s*([-*_])(\s*\1){2,}\s*$", re.M)
_EMPHASIS = re.compile(r"(\*\*|\*|~~)(?=\S)(.+?)(?<=\S)\1")
# Underscores only count outside words, as in Markdown: snake_case stays.
_UNDERSCORE_EMPHASIS = re.compile(r"(?<!\w)(__|_)(?=\S)(.+?)(?<=\S)\1(?!\w)")
_EMOJI = re.compile(
    "[\U0001f000-\U0001faff\U00002600-\U000027bf\U0001f900-\U0001f9ff️‍]"
)
_END = (".", "!", "?", ":", ";", ",")


def clean(text: str) -> str:
    """Plain spoken text: one line per sentence or item, each ending in
    punctuation so the voice pauses between them."""
    text = _FENCED_CODE.sub(" (code omitted) ", text)
    text = _INLINE_CODE.sub(r"\1", text)
    text = _IMAGE.sub(r"\1", text)
    text = _LINK.sub(r"\1", text)
    text = _URL.sub("a link", text)
    text = _TABLE_RULE.sub("", text)
    text = _HR.sub("", text)
    text = _HEADING.sub("", text)
    text = _QUOTE.sub("", text)
    text = _BULLET.sub("", text)
    text = _EMPHASIS.sub(r"\2", text)
    text = _UNDERSCORE_EMPHASIS.sub(r"\2", text)
    text = _EMOJI.sub("", text)

    lines = []
    for line in text.splitlines():
        # A table row reads as a list: "| a | b |" → "a, b".
        if line.count("|") >= 2:
            line = ", ".join(cell.strip() for cell in line.strip().strip("|").split("|") if cell.strip())
        line = re.sub(r"\s+", " ", line).strip()
        if not line:
            continue
        lines.append(line if line.endswith(_END) else line + ".")
    return " ".join(lines)
