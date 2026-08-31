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

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fire_catalogue import canonical_brand, canonical_supplier

# Accepts several workflow directories: the harvest ran in more than one pass,
# and a later run's richer record for the same part should win over an earlier
# sparse one rather than duplicating it.
ARGS = [a for a in sys.argv[1:]]
OUT = Path(ARGS.pop()) if ARGS and ARGS[-1].endswith(".json") else Path("src/seed/catalogue.json")
WF_DIRS = [Path(a) for a in ARGS]

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

# Nothing on a detection loop draws an amp, let alone ten. A figure past this is
# a unit confusion -- amps recorded as milliamps -- and it would silently treble
# a battery calculation rather than fail. Note that a quiescent current larger
# than the alarm current is NOT an error: an aspirator's fan runs constantly and
# a door holder is energised in standby and released in alarm, which is why the
# battery calculator takes the two separately in the first place.
MAX_PLAUSIBLE_MA = 10_000

def current_ma(v, part, field, dropped):
    f = num(v)
    if f is None:
        return None
    if f < 0 or f > MAX_PLAUSIBLE_MA:
        dropped.append(f"{part}: {field}={f} mA is outside anything a loop device draws")
        return None
    return f

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
    journals = []
    for d in WF_DIRS:
        j = d / "journal.jsonl"
        if j.exists():
            journals.append(j)
        else:
            print(f"no journal at {j}", file=sys.stderr)
    if not journals:
        print("no workflow journals found", file=sys.stderr)
        return 1

    seen = {}          # (brand.lower, partNumber.lower) -> row
    suppliers = []
    dropped = 0
    implausible = []

    for line in _lines(journals):
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
                "quiescentMa": current_ma(p.get("quiescentMa"), part, "quiescentMa", implausible),
                "alarmMa": current_ma(p.get("alarmMa"), part, "alarmMa", implausible),
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

    # Merge into whatever is already there rather than replacing it. Not every
    # supplier arrives through a workflow journal -- some come from a vendor's
    # own product API via its own script -- and a re-run of this extractor must
    # not delete rows it did not produce.
    existing = {}
    if OUT.exists():
        try:
            for r in json.loads(OUT.read_text(encoding="utf-8")):
                pn, brand = r.get("partNumber"), r.get("brand")
                if pn and brand:
                    existing[(brand.strip().lower(), pn.strip().lower())] = r
        except (ValueError, OSError) as e:
            print(f"warning: could not read existing {OUT} ({e}); writing fresh")

    kept = 0
    for k, row in seen.items():
        prev = existing.get(k)
        if prev is None or _score(row) > _score(prev):
            existing[k] = row
        else:
            kept += 1

    for r in existing.values():
        r["brand"] = canonical_brand(r.get("brand"))
        r["supplier"] = canonical_supplier(r.get("supplier"))

    # Canonicalising can collide two rows onto one key; keep the richer.
    collapsed = {}
    for r in existing.values():
        k = (r["brand"].strip().lower(), r["partNumber"].strip().lower())
        prev = collapsed.get(k)
        if prev is None or _score(r) > _score(prev):
            collapsed[k] = r

    rows = sorted(collapsed.values(),
                  key=lambda x: (x["brand"].lower(), x.get("category") or "", x["partNumber"]))
    # Absent and null are the same row to the seeder, and nulls were two thirds
    # of the file. Strip them so the bundle carries data rather than padding.
    slim = [{k: v for k, v in r.items() if v is not None} for r in rows]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(slim, ensure_ascii=False, separators=(",", ":")) + "\n",
                   encoding="utf-8")
    if kept:
        print(f"kept {kept} existing rows that were richer than this harvest's")

    by_brand = {}
    for x in rows:
        by_brand[x["brand"]] = by_brand.get(x["brand"], 0) + 1

    print(f"wrote {len(rows)} items to {OUT}  ({dropped} dropped)")
    if implausible:
        # Never silent: a current thrown away without a word looks identical to
        # one that was never published.
        print(f"{len(implausible)} current figure(s) discarded as implausible:")
        for line in implausible[:20]:
            print(f"  {line}")
    print(f"suppliers harvested: {len(suppliers)}")
    for b, n in sorted(by_brand.items(), key=lambda kv: -kv[1])[:25]:
        print(f"  {n:>5}  {b}")
    with_current = sum(1 for x in rows if x.get("quiescentMa") is not None or x.get("alarmMa") is not None)
    print(f"items carrying a current figure: {with_current}")
    return 0

def _lines(journals):
    for j in journals:
        for line in j.open():
            yield line

def _score(row):
    """Prefer the record that carries more usable detail."""
    n = 0
    for k in ("quiescentMa","alarmMa","voltage","protocol","dbAt1m","ipRating","description","sourceUrl"):
        if row.get(k) is not None: n += 1
    if row.get("confidence") == "high": n += 2
    return n

if __name__ == "__main__":
    raise SystemExit(main())
