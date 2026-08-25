"""Reads market/universe.txt into a plain list of symbols."""

from __future__ import annotations

from pathlib import Path

DEFAULT_UNIVERSE = Path(__file__).with_name("universe.txt")

# Index and volatility symbols behind the header tiles. These are quoted the
# same way everything else is but are never screener rows -- an index has no
# market cap, no P/E and no sector, so it would only ever be a row of dashes.
INDICES = [
    ("^GSPC", "S&P 500"),
    ("^IXIC", "Nasdaq"),
    ("^DJI", "Dow 30"),
    ("^RUT", "Russell 2000"),
    ("^VIX", "VIX"),
    ("^TNX", "10Y Yield"),
]


def load(path: str | Path | None = None) -> list[str]:
    """Return the tracked symbols, de-duplicated, in file order.

    The format is deliberately forgiving: any number of symbols per line,
    `#` starts a comment, blank lines are skipped. Symbols are upper-cased so
    `aapl` and `AAPL` are the same entry.
    """
    text = Path(path or DEFAULT_UNIVERSE).read_text(encoding="utf-8")
    seen: dict[str, None] = {}
    for line in text.splitlines():
        for token in line.split("#", 1)[0].split():
            seen.setdefault(token.upper(), None)
    return list(seen)
