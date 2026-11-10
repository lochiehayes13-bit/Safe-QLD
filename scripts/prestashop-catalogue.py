#!/usr/bin/env python3
"""Harvest a PrestaShop storefront's catalogue from its category listings.

FlameStop publishes 5,950 products and no machine-readable feed. Fetching
every product page would mean 5,950 requests of ~300 KB each; the category
listings carry the same part number and name in their markup, so 888 requests
with ?n=1000 get the whole catalogue for a fifteenth of the traffic. That
matters -- this is someone else's server.

Reads a file of category URLs, one per line, and writes catalogue rows.

Usage: prestashop-catalogue.py <categories.txt> <"Supplier"> <out.json> [workers]
"""
import html
import json
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fire_catalogue import BAD_PART, TAG, classify

# url, title and sku come out of one block, so a product missing its reference
# cannot borrow the next one's. The bound on the gap is what enforces that.
PRODUCT = re.compile(
    r'<a class="product-name" href="([^"]+)" title="([^"]*)"'
    r'.{0,800}?itemprop="sku" content="([^"]*)"',
    re.S,
)
SLUG = re.compile(r"/\d+-([a-z0-9-]+)$")


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; SafeQLD-catalogue/1.0)"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read().decode("utf-8", "ignore")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return ""
            time.sleep(2 * (attempt + 1))
        except Exception:
            time.sleep(2 * (attempt + 1))
    return ""


def category_name(url):
    m = SLUG.search(url)
    return m.group(1).replace("-", " ") if m else ""


def scrape(url):
    body = fetch(url + "?n=1000")
    if not body:
        return []
    cat = category_name(url)
    out = []
    for href, title, sku in PRODUCT.findall(body):
        sku = html.unescape(sku).strip()
        name = re.sub(r"\s+", " ", html.unescape(TAG.sub(" ", title))).strip()
        if not sku or BAD_PART.match(sku):
            continue
        out.append((sku, name, href, cat))
    return out


def main(cats_file, supplier, out_path, workers="5"):
    urls = [u.strip() for u in open(cats_file) if u.strip()]
    rows, done = {}, 0

    with ThreadPoolExecutor(max_workers=int(workers)) as ex:
        for found in ex.map(scrape, urls):
            done += 1
            for sku, name, href, cat in found:
                prev = rows.get(sku.lower())
                # Keep the longer name and remember every category a product is
                # filed under -- a product listed in two places is one product.
                if prev:
                    if len(name) > len(prev["name"]):
                        prev["name"] = name
                    if cat and cat not in prev["_cats"]:
                        prev["_cats"].append(cat)
                    continue
                rows[sku.lower()] = {"partNumber": sku, "name": name or sku,
                                     "url": href, "_cats": [cat] if cat else []}
            if done % 100 == 0:
                print(f"  {done}/{len(urls)} categories, {len(rows)} parts", flush=True)

    items = []
    for r in rows.values():
        cat, sub = classify(r["name"], r["_cats"])
        items.append({
            "partNumber": r["partNumber"], "name": r["name"][:140],
            # A distributor's storefront does not name the manufacturer in its
            # listings, so the supplier goes in the brand column and the row
            # says so rather than guessing.
            "brand": supplier, "supplier": supplier,
            "category": cat, "subcategory": sub or (r["_cats"][0].title() if r["_cats"] else None),
            "sourceUrl": r["url"],
            "notes": f"Manufacturer not published by {supplier}; listed under the supplier.",
            "confidence": "medium",
        })

    items.sort(key=lambda x: x["partNumber"])
    Path(out_path).write_text(json.dumps(items, ensure_ascii=False, indent=1))
    from collections import Counter
    print(f"{len(items)} rows -> {out_path}")
    print("categories:", Counter(i["category"] for i in items).most_common())


if __name__ == "__main__":
    main(*sys.argv[1:5])
