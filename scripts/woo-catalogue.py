#!/usr/bin/env python3
"""Turn a WooCommerce store's public product API into catalogue rows.

Several of the fire suppliers Safe QLD buys from run WooCommerce, which
exposes every product through /wp-json/wc/store/products without a key. That
is the supplier's own live data -- part numbers as they appear on the order --
rather than an agent's reading of a PDF.

Two things these stores do not publish reliably:

  Manufacturer. A distributor lists "DCV-CAK-A-OW Hochiki Combined RoR & Fixed
  Heat Detector" with no brand field. Where the manufacturer is named
  unambiguously in the text, or implied by a product family we are sure of, it
  is recorded. Otherwise the supplier goes in the brand column and the row is
  marked medium confidence with a note saying so -- guessing a manufacturer is
  worse than admitting we do not have one.

  Electrical figures. None are published here, so those columns stay empty
  rather than being inferred from a product name.

Usage: woo-catalogue.py <products.json> <"Supplier Name"> <out.json>
"""
import html
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fire_catalogue import BAD_PART, TAG, canonical_brand, classify, clean

# Only tokens that cannot mean anything else. "Sensor", "Advanced" and "Global
# Fire" were tried and matched ordinary words in product descriptions, which is
# how a catalogue ends up asserting a manufacturer that was never named.
BRANDS = [
    "Hochiki", "Kentec", "Vimpex", "Apollo", "System Sensor", "Notifier", "Ampac",
    "Pertronic", "Bosch", "Tyco", "Simplex", "Fike", "Xtralis", "VESDA", "Wagner",
    "Nittan", "Klaxon", "Fulleon", "KAC", "Honeywell", "Siemens", "Morley", "Chubb",
    "Wormald", "Firetrace", "Patol", "Ziton", "Securiton", "Aritech", "C-Tec", "Hoyles",
]
# Product families that name their maker unambiguously in this market.
FAMILY = {
    "Syncro": "Kentec", "Taktis": "Kentec", "Sigma": "Kentec",
    "QE20": "Pertronic", "QE90": "Pertronic", "FireNET": "Hochiki",
}
BRAND_PAT = [(b, re.compile(r"\b" + re.escape(b) + r"\b", re.I)) for b in BRANDS]
FAMILY_PAT = [(v, re.compile(r"\b" + re.escape(k) + r"\b", re.I)) for k, v in FAMILY.items()]


def text_of(p):
    raw = " ".join(filter(None, [p.get("short_description"), p.get("description")]))
    return re.sub(r"\s+", " ", html.unescape(TAG.sub(" ", raw))).strip()


def brand_of(text):
    for name, pat in BRAND_PAT:
        if pat.search(text):
            return name
    for name, pat in FAMILY_PAT:
        if pat.search(text):
            return name
    return None


def main(src, supplier, out):
    products = json.load(open(src))
    rows = {}

    for p in products:
        pn = (p.get("sku") or "").strip()
        if not pn or BAD_PART.match(pn):
            continue

        body = text_of(p)
        cats = [c.get("name") for c in p.get("categories") or []]
        # The store's product name is frequently just the SKU repeated; the
        # readable name lives in the short description's first sentence.
        first = body.split(". ")[0].strip()
        name = first if first and first.lower() != pn.lower() else (clean(p.get("name")) or pn)
        if len(name) > 140:
            name = name[:137].rstrip() + "…"

        brand = brand_of(body + " " + " ".join(c or "" for c in cats))
        cat, sub = classify(f"{name} {body}", cats)

        rows[pn.lower()] = {
            "partNumber": pn,
            "name": name,
            "brand": canonical_brand(brand) if brand else supplier,
            "supplier": supplier,
            "category": cat,
            "subcategory": sub or (cats[0] if cats else None),
            "description": body[:600] if body and body != name else None,
            "sourceUrl": p.get("permalink"),
            "notes": None if brand else f"Manufacturer not published by {supplier}; listed under the supplier.",
            # Identity is straight from the supplier's own store. Where the
            # manufacturer had to be left as the supplier, that is a weaker
            # record and says so.
            "confidence": "high" if brand else "medium",
        }

    out_rows = sorted(rows.values(), key=lambda r: (r["brand"], r["partNumber"]))
    Path(out).write_text(json.dumps(out_rows, ensure_ascii=False, indent=1))
    from collections import Counter
    print(f"{len(out_rows)} rows -> {out}")
    print("brands:", Counter(r["brand"] for r in out_rows).most_common(10))
    print("categories:", Counter(r["category"] for r in out_rows).most_common())


if __name__ == "__main__":
    main(*sys.argv[1:4])
