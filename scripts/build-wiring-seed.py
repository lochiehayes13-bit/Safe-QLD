#!/usr/bin/env python3
"""Assemble the wiring-rules tables into the seed the app ships.

The tables were transcribed from Safe QLD's licensed copies of AS/NZS
3008.1.1 and AS/NZS 3000 by two independent readers per table, with a third
adjudicating every disagreement.  This script takes the adjudicated output
(`<job>.final.json`, or `<job>.A.json` where both readers agreed exactly),
checks it the way a person would check a transcription, and writes the seed.

The checks are the point.  A transcription error in a current-carrying
capacity table puts an undersized cable in a wall, and nobody finds out until
it is warm, so nothing here is trusted because a model produced it:

* every row's value count has to match the table's column count;
* a capacity column has to rise with conductor size, because physics does not
  have exceptions, and a value that falls is a digit read wrong;
* a copper column has to beat the aluminium column beside it;
* every table has to carry the edition it came from and the page it is on.

Anything that fails is reported and, where it is a hard failure, the table is
written with the problem recorded on it rather than silently dropped: a
missing table is discovered on site, and a flagged one is discovered here.

Usage:  python3 scripts/build-wiring-seed.py [--out src/seed/wiring]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from typing import Any

SRC = "/tmp/claude-0/-home-user-Safe-QLD/95b47080-12e4-52bf-8b08-91ab1cf7e072/scratchpad/wiring/out"

# Where each document's figures come from, printed under every answer that
# uses one.  The edition matters: the 2009 tables and the 2017 tables differ.
PROVENANCE = {
    "as3008": "AS/NZS 3008.1.1:2009 incl. Amendment 1:2011 (Safe QLD licensed copy)",
    "as3000": "AS/NZS 3000:2018 incl. Amendments 1 and 2 (Safe QLD licensed copy)",
}

DOC_TITLE = {
    "as3008": "AS/NZS 3008.1.1 — Selection of cables",
    "as3000": "AS/NZS 3000 — Wiring Rules",
}


def job_files(src: str) -> dict[str, str]:
    """One file per job: the adjudicated copy, or the agreed reader's."""
    chosen: dict[str, str] = {}
    for name in sorted(os.listdir(src)):
        if not name.endswith(".json") or name.startswith("_"):
            continue
        stem = name[: -len(".json")]
        if stem.endswith(".final"):
            chosen[stem[: -len(".final")]] = name
    for name in sorted(os.listdir(src)):
        if not name.endswith(".A.json") or name.startswith("_"):
            continue
        key = name[: -len(".A.json")]
        chosen.setdefault(key, name)
    return chosen


def doc_of(job: str) -> str:
    return "as3000" if job.startswith("as3000") else "as3008"


def is_size_key(key: Any) -> float | None:
    """The conductor size a row is about, and nothing else.

    Row keys are not all bare numbers.  A MIMS table prints its rows under two
    voltage sub-headings and the transcription keeps that — "0.6/0.6 kV: 2.5" —
    so the size is the number after the colon, and the text before it is the
    group the row belongs to.
    """
    if isinstance(key, (int, float)):
        return float(key)
    if not isinstance(key, str):
        return None
    tail = key.rsplit(":", 1)[-1]
    m = re.search(r"([0-9]+(?:\.[0-9]+)?)", tail)
    return float(m.group(1)) if m else None


def group_of(key: Any) -> str:
    """Which block of a table a row sits in, or "" where the table is one block."""
    if isinstance(key, str) and ":" in key:
        return key.rsplit(":", 1)[0].strip()
    return ""


CONDUCTOR_WORDS = {
    "cu", "al", "copper", "aluminium", "aluminum",
    "flexible", "solid", "stranded", "solid/stranded",
}


def arrangement(label: str) -> str:
    """A column's installation arrangement, with the conductor taken out.

    The capacity columns are headed as a path — "Unenclosed › Spaced › Cu ›
    Flexible" beside "Unenclosed › Spaced › Al" — so comparing the raw headings
    finds no pairs at all.  Stripping the words that describe the conductor
    itself leaves the arrangement, and two columns with the same arrangement
    are the ones worth comparing.
    """
    parts = [p.strip() for p in re.split(r"[\u203a>|]", label)]
    return " > ".join(p for p in parts if p and p.lower() not in CONDUCTOR_WORDS)


def check_table(table: dict[str, Any], doc: str) -> list[str]:
    problems: list[str] = []
    ref = table.get("ref", "?")
    columns = table.get("columns") or []
    rows = table.get("rows") or []

    if not columns:
        problems.append(f"{ref}: no columns")
    if not rows:
        problems.append(f"{ref}: no rows")
    if not table.get("page"):
        problems.append(f"{ref}: no page recorded, so the figure cannot be checked against the book")

    # Value counts.  A row short of a value has silently shifted every figure
    # after the gap, which is the transcription error that matters most.
    expected = max(0, len(columns) - 1)
    for row in rows:
        values = row.get("values")
        if not isinstance(values, list):
            problems.append(f"{ref}: row {row.get('key')!r} has no values")
            continue
        if expected and len(values) != expected:
            problems.append(
                f"{ref}: row {row.get('key')!r} has {len(values)} values, expected {expected}"
            )

    # Whether the rows are a ladder of conductor sizes at all.  Two tables in
    # AS/NZS 3000 Appendix C are keyed by size AND device rating, so the same
    # size appears five times over with different figures; a monotonic check
    # there compares rows that are about different circuits and finds a fault
    # in every one of them.  So the check only runs on a strictly rising ladder
    # within each printed block.
    first_label = (columns[0].get("label", "") if columns else "").lower()
    keyed_by_size = any(w in first_label for w in ("size", "area", "csa", "mm"))
    blocks: dict[str, list[tuple[float, dict[str, Any]]]] = {}
    ladder = keyed_by_size and bool(rows)
    for row in rows:
        size = is_size_key(row.get("key"))
        if size is None:
            ladder = False
            break
        blocks.setdefault(group_of(row.get("key")), []).append((size, row))
    if ladder:
        for series in blocks.values():
            sizes = [s for s, _ in series]
            if len(set(sizes)) != len(sizes) or sizes != sorted(sizes):
                ladder = False
                break

    if ladder:
        for c in range(expected):
            label = columns[c + 1].get("label", "") if c + 1 < len(columns) else ""
            unit = (columns[c + 1].get("unit") or "") if c + 1 < len(columns) else ""
            # Only two kinds of column move with size on their own: a current
            # rating rises, a volt drop per amp-metre falls.  Everything else
            # (resistance columns aside, which fall, and reactance, which does
            # not move much) is left alone rather than guessed at.
            rising = unit.strip().upper() in {"A", "AMP", "AMPS"}
            falling = "mv" in unit.lower() or unit.strip().lower() in {"ohm/km", "\u03a9/km", "ohms/km"}
            if not rising and not falling:
                continue
            for series in blocks.values():
                points = [
                    (size, row["values"][c])
                    for size, row in series
                    if isinstance(row.get("values"), list)
                    and c < len(row["values"])
                    and isinstance(row["values"][c], (int, float))
                ]
                for (s1, v1), (s2, v2) in zip(points, points[1:]):
                    if rising and v2 < v1:
                        problems.append(
                            f"{ref}: column {c + 2} ({label}) falls from {v1} at {s1} mm2 to {v2} at {s2} mm2"
                        )
                    if falling and v2 > v1:
                        problems.append(
                            f"{ref}: column {c + 2} ({label}) rises from {v1} at {s1} mm2 to {v2} at {s2} mm2"
                        )

    # Copper beats aluminium in the column beside it, at the same size and the
    # same installation arrangement.
    for c in range(expected - 1):
        a = columns[c + 1].get("label", "")
        b = columns[c + 2].get("label", "") if c + 2 < len(columns) else ""
        if not (re.search(r"\bCu\b|copper", a, re.I) and re.search(r"\bAl\b|alumin", b, re.I)):
            continue
        if arrangement(a) != arrangement(b):
            continue
        for row in rows:
            values = row.get("values")
            if not isinstance(values, list) or c + 1 >= len(values):
                continue
            cu, al = values[c], values[c + 1]
            if isinstance(cu, (int, float)) and isinstance(al, (int, float)) and al > cu:
                problems.append(
                    f"{ref}: row {row.get('key')!r} has aluminium {al} above copper {cu} "
                    f"(columns {c + 2} and {c + 3})"
                )

    return problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="src/seed/wiring")
    ap.add_argument("--src", default=SRC)
    args = ap.parse_args()

    files = job_files(args.src)
    if not files:
        print(f"No extracted tables in {args.src}", file=sys.stderr)
        return 1

    tables: list[dict[str, Any]] = []
    all_problems: list[str] = []
    for job, name in sorted(files.items()):
        doc = doc_of(job)
        with open(os.path.join(args.src, name), encoding="utf-8") as fh:
            payload = json.load(fh)
        for table in payload.get("tables", []):
            problems = check_table(table, doc)
            all_problems.extend(problems)
            tables.append(
                {
                    "doc": doc,
                    "docTitle": DOC_TITLE[doc],
                    "source": PROVENANCE[doc],
                    "job": job,
                    "ref": table.get("ref"),
                    "title": table.get("title"),
                    "page": table.get("page"),
                    "meta": table.get("meta") or {},
                    "columns": table.get("columns") or [],
                    "rows": table.get("rows") or [],
                    "notes": table.get("notes") or [],
                    "confidence": table.get("confidence"),
                    # The reader's own doubts, plus everything the checks above
                    # found.  Printed on the table in the app.
                    "problems": (table.get("problems") or []) + problems,
                }
            )

    def sort_key(t: dict[str, Any]) -> tuple[int, float, str]:
        ref = str(t.get("ref") or "")
        m = re.search(r"([0-9]+)(?:\.([0-9]+))?", ref)
        major = float(m.group(1)) if m else 999.0
        minor = float(m.group(2)) / 100 if (m and m.group(2)) else 0.0
        return (0 if t["doc"] == "as3008" else 1, major + minor, ref)

    tables.sort(key=sort_key)

    os.makedirs(args.out, exist_ok=True)
    path = os.path.join(args.out, "tables.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(tables, fh, ensure_ascii=False, separators=(",", ":"))

    rows = sum(len(t["rows"]) for t in tables)
    values = sum(len(r.get("values") or []) for t in tables for r in t["rows"])
    size = os.path.getsize(path)
    print(f"{len(tables)} tables, {rows} rows, {values} figures -> {path} ({size / 1024:.0f} KB)")
    flagged = [t["ref"] for t in tables if t["problems"]]
    if flagged:
        print(f"{len(flagged)} tables carry a problem: {', '.join(str(f) for f in flagged)}")
    for p in all_problems[:40]:
        print("  -", p)
    if len(all_problems) > 40:
        print(f"  … and {len(all_problems) - 40} more")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
