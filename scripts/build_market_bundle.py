#!/usr/bin/env python3
"""Fold the terminal into one self-contained HTML file.

    python3 scripts/build_market_bundle.py --out dist/kaliris-markets.html

The site is normally a folder: index.html, styles.css, app.js and ~150 JSON
files fetched over the network. That is the right shape for a host, and the
wrong shape for handing someone a link they can open immediately.

This inlines the stylesheet, the script and every data file into a single
document. The app is not modified to suit it -- instead `fetch` is shimmed to
answer from an embedded map using the very same paths, so the bundled page runs
exactly the code the hosted one does.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web" / "market"


def _script_safe(text: str) -> str:
    """Make a JSON blob safe to sit inside a <script> element.

    A literal `</script>` anywhere in the data would close the block early and
    the rest of the page would render as text. Escaping the slash is invisible
    to JSON.parse and impossible for the parser to mistake for a tag.
    """
    return text.replace("</", "<\\/")


def collect_data(data_dir: Path) -> dict[str, str]:
    """Map every data file to its fetch path, exactly as the app requests it."""
    payload: dict[str, str] = {}
    for path in sorted(data_dir.rglob("*.json")):
        key = "data/" + path.relative_to(data_dir).as_posix()
        payload[key] = path.read_text(encoding="utf-8")
    return payload


def build(source: Path, out: Path) -> Path:
    html = (source / "index.html").read_text(encoding="utf-8")
    css = (source / "styles.css").read_text(encoding="utf-8")
    js = (source / "app.js").read_text(encoding="utf-8")
    data = collect_data(source / "data")

    # The artifact host supplies <html>, <head> and <body>, so take only what
    # lives inside the body and let the title ride along at the top.
    body = html[html.index("<body>") + len("<body>"):html.rindex("</body>")]
    body = re.sub(r'<script src="app\.js"></script>', "", body)
    title = re.search(r"<title>(.*?)</title>", html, re.S)

    shim = """
/* The bundled page keeps the app's own network code intact and answers it
 * locally instead: same paths, same code path as the hosted site.
 *
 * The embedded files are already parsed objects -- they were written into the
 * document as JavaScript, not as strings -- so the stand-in response hands the
 * object straight back rather than serialising it only to parse it again. */
(function () {
  var files = window.__MARKET_FILES__ || {};
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var key = url.replace(/^\\.\\//, '').split('?')[0].split('/').slice(-3).join('/');
    var value = Object.prototype.hasOwnProperty.call(files, key) ? files[key] : undefined;
    if (value === undefined) {
      var tail = key.split('/').slice(-2).join('/');
      if (Object.prototype.hasOwnProperty.call(files, tail)) value = files[tail];
    }
    if (value !== undefined) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: function () { return Promise.resolve(value); },
        text: function () { return Promise.resolve(JSON.stringify(value)); },
      });
    }
    if (realFetch) return realFetch(input, init);
    return Promise.reject(new Error('not in bundle: ' + key));
  };
})();
"""

    parts = [
        f"<title>{title.group(1) if title else 'Kaliris Markets'}</title>",
        f"<style>\n{css}\n</style>",
        body.strip(),
        "<script>window.__MARKET_FILES__ = {",
        ",\n".join(f"{json.dumps(key)}:{_script_safe(text)}" for key, text in data.items()),
        "};</script>",
        f"<script>{shim}</script>",
        f"<script>\n{js}\n</script>",
    ]

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(parts), encoding="utf-8")
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default=WEB, type=Path)
    parser.add_argument("--out", default=Path("dist/kaliris-markets.html"), type=Path)
    args = parser.parse_args()
    written = build(args.source, args.out)
    size = written.stat().st_size
    print(f"{written} — {size / 1024 / 1024:.2f} MB, {len(collect_data(args.source / 'data'))} data files inlined")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
