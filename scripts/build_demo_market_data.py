#!/usr/bin/env python3
"""Regenerate the committed demo dataset. See market/demo.py."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from market.demo import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
