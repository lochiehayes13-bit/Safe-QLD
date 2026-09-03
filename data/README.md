# Working data

`catalogue.json` is the merge target for every supplier harvest — the one file
each script in `scripts/` reads and writes. It is **not** imported by the app.

What ships is `src/seed/catalogue/`, generated from this file:

```bash
python3 scripts/chunk-catalogue.py data/catalogue.json src/seed/catalogue 1000
```

Editing the working copy alone changes nothing until the chunks are
regenerated, and the app re-seeds only when `CATALOGUE_REVISION` in
`src/seed/catalogueSeed.ts` or the row count changes.
