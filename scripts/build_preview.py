"""Package the site as one self-contained HTML file.

The deployed site is ~19 MB spread over 263 JSON files that it fetches on
demand. That is fine over HTTP and impossible in a single file, so this build
inlines a subset: the complete search index (so search still covers every
player who ever played), the leaderboards, and full season-by-season records
for the highest-scoring careers.

Its reason to exist is previewing on a device that cannot run a local server --
a phone, or a private repo that cannot be published yet. The markup, styles and
application code are the real ones, byte for byte; only the data is trimmed.

    python scripts/build_preview.py --players 600 --out preview.html
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
DATA = WEB / "data"

BOARDS = [
    "lb_career_batting.json",
    "lb_career_pitching.json",
    "lb_season_batting.json",
    "lb_season_pitching.json",
]


def load(name: str):
    return json.loads((DATA / name).read_text())


def top_player_ids(index: dict, limit: int, season_rows: int) -> list[int]:
    """Who gets a full record: the biggest careers, plus the biggest seasons.

    Career totals alone would omit anyone great but short -- Ohtani has six
    seasons and misses a career cut that Hall of Famers set. Adding everyone
    who appears near the top of a single-season board also means the season
    leaderboards link to real pages instead of dead ends.
    """
    scored = sorted(
        zip(index["ids"], index["bp"], index["pp"]),
        key=lambda t: t[1] + t[2],
        reverse=True,
    )
    keep = [pid for pid, _, _ in scored[:limit]]
    seen = set(keep)
    for name in ("lb_season_batting.json", "lb_season_pitching.json"):
        board = load(name)
        col = board["cols"].index("id")
        for row in board["rows"][:season_rows]:
            if row[col] not in seen:
                seen.add(row[col])
                keep.append(row[col])
    return keep


def trim_board(board: dict, limit: int) -> dict:
    """Rows arrive already sorted by points, so the head is the top of the board."""
    return {"cols": board["cols"], "rows": board["rows"][:limit]}


def banner(player_count: int, total: int) -> str:
    return (
        '<div class="preview-banner">'
        "<b>Preview build</b> — a single offline file, no server needed. "
        f"Search covers all {total:,} players; full season logs are included for "
        f"the {player_count:,} biggest careers and best individual seasons. "
        "The deployed site carries every player and every season."
        "</div>"
    )


BANNER_CSS = """
.preview-banner {
  max-width: 900px; margin: 18px auto -6px; padding: 11px 18px;
  border: 1px solid var(--border-strong); border-left: 3px solid var(--accent);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  background: var(--accent-wash); color: var(--text-muted);
  font-size: 12.5px; font-style: italic; line-height: 1.6; text-align: center;
}
.preview-banner b { color: var(--accent); font-style: normal; }
"""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--players", type=int, default=600,
                    help="how many careers get full season logs")
    ap.add_argument("--board-rows", type=int, default=2500,
                    help="rows kept per leaderboard")
    ap.add_argument("--season-rows", type=int, default=1200,
                    help="depth of each season board whose players get full records")
    ap.add_argument("--out", default="preview.html")
    args = ap.parse_args()

    meta = load("meta.json")
    index = load("search.json")
    percentiles = load("percentiles.json")

    keep = top_player_ids(index, args.players, args.season_rows)
    players: dict[str, dict] = {}
    shards: dict[int, dict] = {}
    for pid in keep:
        shard = pid % meta["shards"]
        if shard not in shards:
            shards[shard] = json.loads((DATA / "players" / f"{shard}.json").read_text())
        record = shards[shard].get(str(pid))
        if record:
            players[str(pid)] = record

    payload = {
        "meta.json": meta,
        "search.json": index,
        "percentiles.json": percentiles,
        "players": players,
        "playerCount": len(players),
    }
    # The category-leader tables are tiny and must not be trimmed: the whole
    # point of them is that they are the real leaders, not the leaders among
    # whoever happened to make the preview subset.
    leaders = DATA / "leaders.json"
    if leaders.exists():
        payload["leaders.json"] = json.loads(leaders.read_text())
    for name in BOARDS:
        payload[name] = trim_board(load(name), args.board_rows)

    # Football and basketball ride along under league-scoped keys. Their
    # datasets are small enough to carry whole boards; only the per-player
    # records are trimmed, on the same "biggest careers plus best seasons"
    # rule the baseball subset uses.
    for league in ("nfl", "nba"):
        ddir = WEB / f"data-{league}"
        if not (ddir / "meta.json").exists():
            continue
        lmeta = json.loads((ddir / "meta.json").read_text())
        lindex = json.loads((ddir / "search.json").read_text())
        payload[f"{league}:meta.json"] = lmeta
        payload[f"{league}:search.json"] = lindex
        payload[f"{league}:percentiles.json"] = json.loads(
            (ddir / "percentiles.json").read_text())
        for board in ("lb_career.json", "lb_season.json"):
            raw = json.loads((ddir / board).read_text())
            payload[f"{league}:{board}"] = trim_board(raw, args.board_rows)
        lleaders = ddir / "leaders.json"
        if lleaders.exists():
            payload[f"{league}:leaders.json"] = json.loads(lleaders.read_text())

        ranked = sorted(zip(lindex["ids"], lindex["bp"]), key=lambda t: -t[1])
        keep_l = [pid for pid, _ in ranked[:args.players]]
        season_board = json.loads((ddir / "lb_season.json").read_text())
        col = season_board["cols"].index("id")
        seen_l = set(keep_l)
        for row in season_board["rows"][:args.season_rows]:
            if row[col] not in seen_l:
                seen_l.add(row[col])
                keep_l.append(row[col])
        lplayers, lshards = {}, {}
        for pid in keep_l:
            shard = pid % lmeta["shards"]
            if shard not in lshards:
                lshards[shard] = json.loads(
                    (ddir / "players" / f"{shard}.json").read_text())
            rec = lshards[shard].get(str(pid))
            if rec:
                lplayers[str(pid)] = rec
        payload[f"{league}:players"] = lplayers
        print(f"  + {league}: {len(lplayers)} player records")

    # Real markup, real styles, real application code -- only the data differs.
    html = (WEB / "index.html").read_text()
    body = html.split("<body>", 1)[1].split("</body>", 1)[0]
    body = body.replace('<script src="app.js"></script>', "")
    head = html.split("<head>", 1)[1].split("</head>", 1)[0]
    theme_script = re.search(r"<script>.*?</script>", head, re.S)

    styles = (WEB / "styles.css").read_text()
    app_js = (WEB / "app.js").read_text()
    body = body.replace('<main id="app">', banner(len(players), meta["players"])
                        + '\n<main id="app">')

    out = Path(args.out)
    if not out.is_absolute():
        out = ROOT / out
    # The viewport meta is not optional. Without it a phone lays the page out at
    # ~980px and then scales down, which also triggers Chrome's font boosting --
    # the responsive breakpoints never fire and every stat tile overflows.
    out.write_text(
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '<meta name="color-scheme" content="light dark">\n'
        f"<title>Dynasty Analytics — Preview</title>\n"
        f"<style>\n{styles}\n{BANNER_CSS}</style>\n"
        f"{theme_script.group(0) if theme_script else ''}\n"
        f"{body}\n"
        f"<script>window.__DSA_DATA__ = "
        f"{json.dumps(payload, separators=(',', ':'))};</script>\n"
        f"<script>\n{app_js}\n</script>\n"
    )
    print(f"{out} -> {out.stat().st_size / 1e6:.1f} MB "
          f"({len(players)} full player records, {args.board_rows} rows/board)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
