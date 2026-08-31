#!/usr/bin/env python3
"""Turn Honeywell's public Notifier product API dump into catalogue rows.

Honeywell publishes its Australian product and SKU data through the same
search API its own website uses, so the part numbers here come from the
manufacturer rather than from a reseller's page or an agent's reading of a
PDF. That is the highest-confidence source we have.

Two inputs, because the API splits them:
  products.json  product records, each with a comma-separated sku_list
  skus.json      per-SKU descriptions and leaf categories, where published

sku_list is the authoritative set of part numbers; skus.json enriches the
subset that has its own record. Electrical figures are not published through
this API, so those fields stay null rather than being guessed at.
"""
import json, re, sys
from pathlib import Path

SUPPLIER = "Honeywell — Notifier Australia"
BASE = "https://buildings.honeywell.com"

# Leaf category is per-SKU and far more precise than the product's path, so it
# wins where it exists. Anything unmapped falls through to the path below.
LEAF = {
    "Smoke Detectors": ("detector", "Smoke"),
    "Heat Detectors": ("detector", "Heat"),
    "Duct Detectors": ("detector", "Duct"),
    "Multi-Criteria/Multi-Sensor Detectors": ("detector", "Multi-criteria"),
    "Flame Detectors": ("detector", "Flame"),
    "Beam Detectors": ("beam", None),
    "Aspirating Smoke Detector": ("aspirating", None),
    "Sampling Pipe": ("aspirating", "Sampling pipe"),
    "Bases": ("base", None),
    "Manual Call Points/Pull Stations": ("mcp", None),
    "Manual Call Point/Pull Station Parts": ("mcp", "Parts"),
    "Fire Alarm Control Panels": ("panel", None),
    "Releasing Panels": ("panel", "Releasing"),
    "Monitor Modules": ("module", "Monitor"),
    "Control Modules": ("module", "Control"),
    "Relay Modules": ("module", "Relay"),
    "Specialty Modules": ("module", "Specialty"),
    "Network Cards & Modules": ("module", "Network"),
    "Interface Cards": ("module", "Interface"),
    "Isolator Modules": ("isolator", None),
    "Power Supplies": ("power-supply", None),
    "Batteries": ("battery", None),
    "Strobes & Signal Lights": ("strobe", None),
    "Combination Strobes": ("sounder-strobe", None),
    "Horns & Sounders": ("sounder", None),
    "Speakers": ("sounder", "Speaker"),
    "Annunciators & Keypads": ("ancillary", "Annunciator"),
    "Monitors & Displays": ("ancillary", "Display"),
    "Housings & Hardware": ("accessory", "Enclosure"),
    "Parts & Accessories": ("accessory", None),
    "Accessories": ("accessory", None),
    "Detector Test Equipment": ("tool", "Detector test"),
    # Gas detection and plant controllers ship under the same catalogue but are
    # not fire devices. Kept, because a technician who searches a part number
    # should find it, but categorised honestly so they do not pad the detector
    # list.
    "Gas Detectors": ("other", "Gas detection"),
    "Plant & Integration Controllers": ("other", "Plant/integration"),
}

PATH = [
    ("aspirating-smoke-detector", ("aspirating", None)),
    ("beam-detectors", ("beam", None)),
    ("conventional-manual-call-point", ("mcp", "Conventional")),
    ("manual-call-points", ("mcp", None)),
    ("intelligent-modules", ("module", "Addressable")),
    ("digital-input-and-outputs", ("module", "I/O")),
    ("point-detectors", ("detector", None)),
    ("intelligent-devices", ("detector", "Addressable")),
    ("conventional-devices", ("detector", "Conventional")),
    ("sounder-and-strobes", ("sounder-strobe", None)),
    ("intelligent-audiovisual", ("sounder-strobe", "Addressable")),
    ("conventional-audio-visual", ("sounder-strobe", "Conventional")),
    ("bases", ("base", None)),
    ("power-supplies-and-chargers", ("power-supply", None)),
    ("batteries", ("battery", None)),
    ("enclosure", ("accessory", "Enclosure")),
    ("control-panels", ("panel", None)),
    ("annunciators", ("ancillary", "Annunciator")),
    ("graphical-annunciators", ("ancillary", "Annunciator")),
    ("network-systems", ("ancillary", "Network")),
    ("gateways", ("ancillary", "Gateway")),
    ("swift", ("detector", "Wireless")),
    ("accessories", ("accessory", None)),
]

# Honeywell's merchandising path is unreliable on its own: a keychain sits under
# control-panels, and gas controllers under the same. The product's own name is
# much better evidence, so it is read before the path is trusted. Ordered, most
# specific first -- "detector test kit" is a tool, not a detector.
NAME_RULES = [
    (r"\btest (kit|gas|lamp|magnet)|\bdetector tester|\btest pole|removal tool|\btester\b", ("tool", "Test equipment")),
    (r"\bkeychain|\blanyard|\bsticker|\bbrochure|\bposter\b", ("other", "Merchandise")),
    (r"\btraining\b|\bcourse\b|\bclassroom\b|\bsoftware licen[cs]e", ("other", "Service or licence")),
    (r"\bback ?box|\bmounting (box|block|bracket|kit|plate|chassis)|\bchassis\b|\bsurface box|\benclosure|\bcabinet|\bbackbox|\bdoor kit|\btrim ring|\bblank(ing)? plate", ("accessory", "Enclosure or mounting")),
    (r"\bcable\b|\bwiring loom|\bharness\b", ("cable", None)),
    (r"\bsampling pipe|\bpipe fitting|\bcapillary|\bair sampling point", ("aspirating", "Pipework")),
    (r"\baspirat|\bvesda|\bfaast\b|\bstratos\b", ("aspirating", None)),
    (r"\bbeam detector|\breflector\b|\bosid\b", ("beam", None)),
    (r"\b(gas|oxygen|toxic|lel|voc|pid|combustible) (detector|sensor|monitor)|\bgas detection|\bexplosion proof|\bsensepoint|\btouchpoint|\bsearchpoint|\bimpulse\b|\braevert|\bareara?e\b|\bmultirae|\bminirae|\bultrarae", ("other", "Gas detection")),
    (r"\bmanual call point|\bpull station|\bbreak ?glass|\bmcp\b", ("mcp", None)),
    (r"\bisolator\b", ("isolator", None)),
    (r"\b(monitor|control|relay|input|output|zone|interface|network|loop) module\b|\bmodule,|\bncm-|\bnotifier network", ("module", None)),
    (r"\bdetector base|\b(relay|isolator|sounder|standard|conventional|addressable|low ?profile) base\b|\bbase,? (standard|relay|isolator|sounder)|\bmounting base|\bb\d{3}[a-z]*\b base", ("base", None)),
    (r"\bduct (detector|housing|smoke)", ("detector", "Duct")),
    (r"\b(photo|photoelectric|optical|ionisation|ionization|multi-?criteria|multi-?sensor|heat|thermal|flame|smoke) (detector|sensor|alarm)|\bdetector,? (photo|heat|smoke|multi)", ("detector", None)),
    (r"\bdetector\b|\bdetection head\b", ("detector", None)),
    (r"\b(sounder|horn|speaker|loudspeaker) ?/? ?(strobe|beacon)|\bcombination strobe|\baudible (and|&) visual|\bsounder ?\+ ?(strobe|beacon)", ("sounder-strobe", None)),
    (r"\bstrobe\b|\bbeacon\b|\bvisual (alarm|indicator|signal)", ("strobe", None)),
    (r"\bsounder\b|\bhorn\b|\bbell\b|\b(loud)?speaker\b|\bsiren\b", ("sounder", None)),
    (r"\bbatter(y|ies)\b|\bsla\b|\b\d+ ?ah\b", ("battery", None)),
    (r"\bpower supply|\bcharger\b|\bpsu\b|\btransformer\b", ("power-supply", None)),
    (r"\bannunciator|\bkeypad\b|\bmimic (panel|display)|\brepeater\b|\bdisplay,? ", ("ancillary", "Annunciator")),
    (r"\b(control|fire alarm|releasing|addressable|conventional) panel\b|\bfacp\b|\bpanel,? ", ("panel", None)),
]
NAME_RULES = [(re.compile(p, re.I), v) for p, v in NAME_RULES]

# SKU descriptions are sometimes just the category word, which makes a useless
# name. Fall back to the product family name in that case.
JUNK_NAME = re.compile(r"^(accessor(y|ies)|parts?( & accessories)?|spares?|other|misc(ellaneous)?|n/?a)$", re.I)

# A product record lists every platform the device works with. NOTIFIER is the
# one sold here, so it wins; otherwise take the first named brand.
BRAND_PREF = ["NOTIFIER", "Xtralis", "System Sensor", "Morley-IAS", "KAC",
              "Gamewell-FCI", "Farenhyt", "Fire-Lite", "Silent Knight", "ESSER",
              "Gent", "Eltek", "RAE", "Honeywell"]
BRAND_CASE = {"NOTIFIER": "Notifier"}

# Services and training are not parts.
SKIP_PATH = re.compile(r"training-services|/services/", re.I)
BAD_PART = re.compile(r"^(n/?a|tbc|tba|unknown|various|contact|-+|\?+)$", re.I)
TAG = re.compile(r"<[^>]+>")


def brand_of(spec_raw):
    try:
        spec = json.loads(spec_raw or "[]")
    except (ValueError, TypeError):
        return "Notifier"
    raw = next((s["value"] for s in spec if s.get("name") == "Brand"), None)
    if not raw:
        return "Notifier"
    names = [n.strip() for n in str(raw).split("|") if n.strip()]
    for pref in BRAND_PREF:
        if pref in names:
            return BRAND_CASE.get(pref, pref)
    return BRAND_CASE.get(names[0], names[0]) if names else "Notifier"


def category_of(leaf, brandpath, text):
    if leaf and leaf in LEAF:
        return LEAF[leaf]
    for pat, cat in NAME_RULES:
        if pat.search(text or ""):
            return cat
    for frag, cat in PATH:
        if frag in (brandpath or ""):
            return cat
    return ("other", None)


def clean(text):
    if not text:
        return None
    t = TAG.sub(" ", str(text))
    t = re.sub(r"&nbsp;?", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t or None


def main(products_path, skus_path, out_path):
    products = json.load(open(products_path))
    skus = json.load(open(skus_path))

    rows = {}
    for pid, p in products.items():
        path = p.get("brandpath") or ""
        url = p.get("url") or ""
        if SKIP_PATH.search(path) or SKIP_PATH.search(url):
            continue

        brand = brand_of(p.get("spec"))
        pname = clean(p.get("name"))
        pdesc = clean(p.get("desc")) or clean(p.get("long"))
        source = BASE + url if url.startswith("/") else (url or None)

        detailed = {s["pn"]: s for s in skus.get(pid, []) if s.get("pn")}
        listed = [s.strip() for s in (p.get("sku_list") or "").split(",") if s.strip()]

        for raw_pn in dict.fromkeys(listed + list(detailed)):
            d = detailed.get(raw_pn) or {}
            # Some records carry a "//" prefix from the site's own routing.
            pn = raw_pn.strip().lstrip("/").strip()
            if not pn or BAD_PART.match(pn):
                continue
            desc = clean(d.get("d")) or pdesc
            # The SKU description is the specific variant; the product name is
            # the family. Prefer the specific one, keep the family as context.
            sku_name = clean(d.get("d"))
            if sku_name and JUNK_NAME.match(sku_name):
                sku_name = None
            name = sku_name or pname or pn
            if JUNK_NAME.match(name):
                cat, sub = ("accessory", None)
            else:
                cat, sub = category_of(d.get("cat"), path, f"{name} {pname or ''}")
            if len(name) > 120:
                name = name[:117].rstrip() + "…"

            row = {
                "partNumber": pn, "name": name, "brand": brand, "supplier": SUPPLIER,
                "category": cat, "subcategory": sub or (d.get("cat") if d.get("cat") else None),
                "description": desc if desc != name else pdesc,
                "voltage": None, "quiescentMa": None, "alarmMa": None, "protocol": None,
                "dbAt1m": None, "ipRating": None, "standards": None,
                "notes": pname if pname and pname != name else None,
                "sourceUrl": source,
                # Straight from the manufacturer's own product API: the part
                # number and name are as published. No electrical figures are
                # claimed, so there is nothing here to be less sure about.
                "confidence": "high",
            }
            key = (brand.lower(), pn.lower())
            prev = rows.get(key)
            if prev is None or sum(v is not None for v in row.values()) > sum(
                    v is not None for v in prev.values()):
                rows[key] = row

    out = sorted(rows.values(), key=lambda r: (r["brand"], r["partNumber"]))
    Path(out_path).write_text(json.dumps(out, indent=1, ensure_ascii=False))
    print(f"{len(out)} rows -> {out_path}")
    from collections import Counter
    print("by brand:", Counter(r["brand"] for r in out).most_common())
    print("by category:", Counter(r["category"] for r in out).most_common())


if __name__ == "__main__":
    main(*sys.argv[1:4])
