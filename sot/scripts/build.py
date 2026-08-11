"""Package SOT as one self-contained HTML file.

The application is written as separate modules under src/ because that is how
it needs to be maintained. It ships as a single file because that is how it can
be opened anywhere — an artifact page, an attachment, a laptop with no
toolchain — with no server and no build step at the far end.

Nothing is minified or transformed: the markup, styles and code in the bundle
are the source files, concatenated in load order.

    python3 sot/scripts/build.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
OUT = ROOT / "dist" / "sot.html"


def read(rel: str) -> str:
    return (SRC / rel).read_text(encoding="utf-8")


def build() -> str:
    index = read("index.html")
    css = re.findall(r'<link rel="stylesheet" href="([^"]+)"', index)
    js = re.findall(r'<script src="([^"]+)"></script>', index)
    title = re.search(r"<title>(.*?)</title>", index, re.S).group(1).strip()
    desc = re.search(r'<meta name="description" content="([^"]*)"', index).group(1)

    parts = [f"<title>{title}</title>", f'<meta name="description" content="{desc}">']
    for name in css:
        parts.append("<style>\n" + read(name).strip() + "\n</style>")
    parts.append('<div id="app"></div>')
    for name in js:
        body = read(name).strip().replace("</script>", "<\\/script>")
        parts.append(f"<script>\n/* --- {name} --- */\n{body}\n</script>")
    return "\n".join(parts) + "\n"


def main() -> int:
    html = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT.parent)}  ({len(html.encode('utf-8')) / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
