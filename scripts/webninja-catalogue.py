#!/usr/bin/env python3
"""Harvest a WebNinja storefront's catalogue.

One Stop Fire Shop runs WebNinja, which puts the part number ("Stock Code")
only on the product page — the category listings carry names and links but no
codes. So unlike the PrestaShop harvest this has to visit each product, in two
stages: walk the categories for the product URLs, then read each product.

Politeness matters more here for that reason: modest concurrency, and the
category walk is deduplicated first so a product filed under three categories
is fetched once rather than three times.

Usage: webninja-catalogue.py <base-url> <"Supplier"> <out.json> [workers]
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

UA = "Mozilla/5.0 (compatible; SafeQLD-catalogue/1.0)"
CATEGORY = re.compile(r'href="(?:https?://[^"/]+)?(/category/\d+-[^"?]+)')
PRODUCT = re.compile(r'href="(?:https?://[^"/]+)?(/product/\d+-[^"?]+)')
STOCK_CODE = re.compile(
    r'Stock Code:\s*</div>\s*<div class="value">(.*?)</div>', re.S | re.I)
TITLE = re.compile(r"<h1[^>]*>(.*?)</h1>", re.S)
BREADCRUMB = re.compile(r'/category/\d+-([a-z0-9-]+)')


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", "ignore")
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                return ""
            time.sleep(2 * (attempt + 1))
        except Exception:
            time.sleep(2 * (attempt + 1))
    return ""


def clean_text(raw):
    return re.sub(r"\s+", " ", html.unescape(TAG.sub(" ", raw or ""))).strip()


def main(base, supplier, out_path, workers="5"):
    base = base.rstrip("/")

    home = fetch(base)
    categories = sorted({base + m for m in CATEGORY.findall(home)})
    print(f"{len(categories)} categories", flush=True)

    # Stage one: every product URL, deduplicated, so a product filed under
    # several categories is fetched once.
    products = {}
    done = 0
    with ThreadPoolExecutor(max_workers=int(workers)) as ex:
        for cat_url, body in zip(categories, ex.map(fetch, categories)):
            done += 1
            slug = BREADCRUMB.search(cat_url)
            cat_name = slug.group(1).replace("-", " ") if slug else ""
            for path in PRODUCT.findall(body):
                products.setdefault(path, set()).add(cat_name)
            if done % 50 == 0:
                print(f"  {done}/{len(categories)} categories, {len(products)} products", flush=True)
    print(f"{len(products)} distinct products", flush=True)

    # Stage two: the part number, which only the product page carries.
    def one(item):
        path, cats = item
        body = fetch(base + path)
        if not body:
            return None
        code = STOCK_CODE.search(body)
        if not code:
            return None
        pn = clean_text(code.group(1))
        if not pn or BAD_PART.match(pn):
            return None
        title = TITLE.search(body)
        name = clean_text(title.group(1)) if title else pn
        cat, sub = classify(name, sorted(cats))
        return {
            "partNumber": pn, "name": name[:140],
            # A storefront does not name the manufacturer, so the supplier goes
            # in the brand column and the row says so rather than guessing.
            "brand": supplier, "supplier": supplier,
            "category": cat,
            "subcategory": sub or (sorted(cats)[0].title() if cats else None),
            "sourceUrl": base + path,
            "notes": f"Manufacturer not published by {supplier}; listed under the supplier.",
            "confidence": "medium",
        }

    rows, done = {}, 0
    with ThreadPoolExecutor(max_workers=int(workers)) as ex:
        for row in ex.map(one, products.items()):
            done += 1
            if row:
                prev = rows.get(row["partNumber"].lower())
                if not prev or len(row["name"]) > len(prev["name"]):
                    rows[row["partNumber"].lower()] = row
            if done % 200 == 0:
                print(f"  {done}/{len(products)} products, {len(rows)} parts", flush=True)

    items = sorted(rows.values(), key=lambda r: r["partNumber"])
    Path(out_path).write_text(json.dumps(items, ensure_ascii=False, indent=1))
    from collections import Counter
    print(f"{len(items)} rows -> {out_path}")
    print("categories:", Counter(i["category"] for i in items).most_common())


if __name__ == "__main__":
    main(*sys.argv[1:5])
