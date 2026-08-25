"""Kaliris Markets — the data pipeline behind the terminal in web/market.

Four small modules, in the order the build uses them:

    universe.py   which symbols we track (reads market/universe.txt)
    sources.py    every outbound HTTP call lives here, and nowhere else
    metrics.py    pure functions: OHLCV in, technical columns out
    build.py      orchestrates the above and writes web/market/data/*.json

Keeping the network confined to sources.py is deliberate: metrics.py is then
trivially unit-testable, and swapping a data provider touches one file.
"""

__all__ = ["universe", "sources", "metrics", "build"]
