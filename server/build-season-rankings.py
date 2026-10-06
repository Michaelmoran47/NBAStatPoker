import json, re, sys
from html.parser import HTMLParser

CATS = {"pts": "pts_per_g", "ast": "ast_per_g", "reb": "trb_per_g",
        "blk": "blk_per_g", "stl": "stl_per_g", "tov": "tov_per_g"}
MIN_GAMES = 20
TOP_N = 100

class TableParser(HTMLParser):
    """Collects rows of <table id="per_game_stats"> as {data-stat: text}."""
    def __init__(self):
        super().__init__()
        self.in_table = self.in_cell = False
        self.depth = 0
        self.rows, self.row, self.cell_stat, self.buf = [], None, None, []
        self.in_tbody = False
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "table" and a.get("id") == "per_game_stats":
            self.in_table = True; self.depth = 0
        if not self.in_table:
            return
        if tag == "table": self.depth += 1
        if tag == "tbody": self.in_tbody = True
        if tag == "tr" and self.in_tbody and "thead" not in a.get("class", ""):
            self.row = {}
        if tag in ("td", "th") and self.row is not None:
            self.cell_stat = a.get("data-stat"); self.in_cell = True; self.buf = []
    def handle_endtag(self, tag):
        if not self.in_table:
            return
        if tag in ("td", "th") and self.in_cell:
            self.row[self.cell_stat] = "".join(self.buf).strip(); self.in_cell = False
        if tag == "tr" and self.row is not None:
            if self.row: self.rows.append(self.row)
            self.row = None
        if tag == "tbody": self.in_tbody = False
        if tag == "table":
            self.depth -= 1
            if self.depth == 0: self.in_table = False
    def handle_data(self, data):
        if self.in_cell: self.buf.append(data)

def clean(name):
    return re.sub(r"[*]", "", name).strip()

def season_rows(path):
    p = TableParser()
    p.feed(open(path, encoding="utf-8", errors="replace").read())
    by_player = {}
    for r in p.rows:
        name = r.get("name_display")
        if not name or r.get("ranker") is None and "games" not in r:
            continue
        name = clean(name)
        team = r.get("team_name_abbr", "")
        # Players traded mid-season appear once per team plus a combined TOT row.
        # Keep TOT when it exists so stats reflect the full season.
        if name in by_player and by_player[name]["team"] == "TOT":
            continue
        if name in by_player and team != "TOT":
            continue
        by_player[name] = {"team": team, "row": r}
    return [v["row"] | {"name": k} for k, v in by_player.items()]

def num(s):
    try: return float(s)
    except (TypeError, ValueError): return None

out = {"source": "basketball-reference.com per-game tables", "minGames": MIN_GAMES,
       "topN": TOP_N, "seasons": {}}
for y in range(2000, 2026):
    rows = [r for r in season_rows(sys.argv[1] + f"/{y}.html")
            if (num(r.get("games")) or 0) >= MIN_GAMES]
    season = {}
    for cat, stat in CATS.items():
        ranked = sorted(((num(r.get(stat)), r) for r in rows if num(r.get(stat)) is not None),
                        key=lambda t: -t[0])
        entries, prev_val, rank = [], None, 0
        for i, (val, r) in enumerate(ranked, start=1):
            if val != prev_val: rank = i   # competition ranking: ties share a rank
            prev_val = val
            if rank > TOP_N: break
            entries.append({"rank": rank, "name": r["name"], "value": round(val, 1)})
        season[cat] = entries
    out["seasons"][str(y)] = season
    print(y, len(rows), "eligible,", len(season["pts"]), "pts entries", file=sys.stderr)

json.dump(out, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
