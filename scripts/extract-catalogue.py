#!/usr/bin/env python3
"""Pull harvested supplier catalogues out of a workflow journal into a seed file.

The harvest runs as a background workflow whose results land in journal.jsonl.
This turns those results into src/seed/catalogue.json, which the app bundles and
loads into SQLite on first run.

Rows without a part number, or whose part number is obviously a placeholder, are
dropped rather than shipped -- a fabricated part number sends someone to order
the wrong thing.
"""
import json, sys, re, os
from pathlib import Path

WF_DIR = Path(sys.argv[1]) if len(sys.argv) > 1 else None
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("src/seed/catalogue.json")

VALID_CATEGORIES = {
    "detector","mcp","panel","module","sounder","strobe","sounder-strobe","aspirating",
    "beam","base","isolator","power-supply","battery","ewis","wip","extinguisher",
    "hose-reel","hydrant","sprinkler","signage","emergency-lighting","cable","ancillary",
    "tool","accessory","other",
}

# Placeholder-looking part numbers we refuse to ship.
BAD_PART = re.compile(r"^(n/?a|tbc|tba|unknown|various|contact|-+|\?+)$", re.I)

def num(v):
    if v is None: return None
    try:
        f = float(v)
        return f if f == f and abs(f) < 1e7 else None   # reject NaN and nonsense
    except (TypeError, ValueError):
        return None

# Harvesters name brands inconsistently once a supplier resells several
# platforms -- "Brooks", "Brooks (Panasonic/EBL FireTracker)" and
# "Brooks (Ei Electronics platform)" are all Brooks. Collapsing them keeps the
# brand filter usable; the platform detail moves to subcategory where it is
# still visible but not fragmenting the list.
BRAND_QUALIFIER = re.compile(r"\s*\(([^)]*)\)\s*$")

def split_brand(raw):
    """Returns (canonical brand, platform qualifier or None)."""
    if not raw:
        return None, None
    b = str(raw).strip()
    qualifier = None
    m = BRAND_QUALIFIER.search(b)
    if m:
        qualifier = m.group(1).strip() or None
        b = BRAND_QUALIFIER.sub("", b).strip()
    # "Ampac / Apollo" means an Apollo device sold by Ampac; the manufacturer
    # is the useful half for a technician looking up a datasheet.
    if "/" in b:
        left, _, right = b.partition("/")
        left, right = left.strip(), right.strip()
        if left and right:
            b, qualifier = right, qualifier or f"via {left}"
    return (b or None), qualifier

def clean(s, limit=400):
    if s is None: return None
    s = str(s).strip()
    return s[:limit] if s else None

def main():
    if not WF_DIR or not WF_DIR.exists():
        print(f"workflow dir not found: {WF_DIR}", file=sys.stderr)
        return 1

    journal = WF_DIR / "journal.jsonl"
    if not journal.exists():
        print(f"no journal at {journal}", file=sys.stderr)
        return 1

    seen = {}          # (brand.lower, partNumber.lower) -> row
    suppliers = []
    dropped = 0

    for line in journal.open():
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue
        if d.get("type") != "result":
            continue
        r = d.get("result") or {}
        products = r.get("products") or []
        if not products:
            continue
        suppliers.append({"supplier": r.get("supplier"), "count": len(products),
                          "notes": clean(r.get("coverage_notes"), 2000)})

        for p in products:
            part = clean(p.get("partNumber"), 80)
            brand, platform = split_brand(clean(p.get("brand"), 80))
            if not part or not brand or BAD_PART.match(part):
                dropped += 1
                continue
            cat = (p.get("category") or "other").strip().lower()
            if cat not in VALID_CATEGORIES:
                cat = "other"
            key = (brand.lower(), part.lower())
            row = {
                "partNumber": part,
                "name": clean(p.get("name"), 200) or part,
                "brand": brand,
                "supplier": clean(r.get("supplier"), 120),
                "category": cat,
                "subcategory": clean(p.get("subcategory"), 80) or platform,
                "description": clean(p.get("description"), 600),
                "voltage": clean(p.get("voltage"), 60),
                "quiescentMa": num(p.get("quiescentMa")),
                "alarmMa": num(p.get("alarmMa")),
                "protocol": clean(p.get("protocol"), 60),
                "dbAt1m": num(p.get("dbAt1m")),
                "ipRating": clean(p.get("ipRating"), 30),
                "standards": clean(p.get("standards"), 200),
                "notes": clean(p.get("notes"), 400),
                "sourceUrl": clean(p.get("sourceUrl"), 400),
                "confidence": (p.get("confidence") or "medium").lower(),
            }
            # A later, richer record wins over an earlier sparse one.
            prev = seen.get(key)
            if prev is None or _score(row) > _score(prev):
                seen[key] = row

    rows = sorted(seen.values(), key=lambda x: (x["brand"].lower(), x["category"], x["partNumber"]))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(rows, indent=0, ensure_ascii=False), encoding="utf-8")

    by_brand = {}
    for x in rows:
        by_brand[x["brand"]] = by_brand.get(x["brand"], 0) + 1

    print(f"wrote {len(rows)} items to {OUT}  ({dropped} dropped)")
    print(f"suppliers harvested: {len(suppliers)}")
    for b, n in sorted(by_brand.items(), key=lambda kv: -kv[1])[:25]:
        print(f"  {n:>5}  {b}")
    with_current = sum(1 for x in rows if x["quiescentMa"] is not None or x["alarmMa"] is not None)
    print(f"items carrying a current figure: {with_current}")
    return 0

def _score(row):
    """Prefer the record that carries more usable detail."""
    n = 0
    for k in ("quiescentMa","alarmMa","voltage","protocol","dbAt1m","ipRating","description","sourceUrl"):
        if row.get(k) is not None: n += 1
    if row.get("confidence") == "high": n += 2
    return n

if __name__ == "__main__":
    raise SystemExit(main())
