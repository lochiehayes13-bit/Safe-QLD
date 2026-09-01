import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { STANDARDS } from '@/domain/standardsCatalogue';

/**
 * Where a clause says "this screen answers it", the screen has to exist.
 *
 * The library lets a technician tap a clause and land on the tool that answers
 * it, which is the single most useful thing the catalogue does — and it is a
 * plain string pushed at the router, so a target that does not resolve is a
 * dead button rather than an error. Nothing at compile time or run time
 * complains: the tap simply does nothing, and the technician concludes the
 * library is broken.
 *
 * The repository already checks navigation targets this way from screens. This
 * is the same check from the catalogue, which is the other place routes are
 * named as data.
 *
 * A target must also be a screen that works when it is opened cold. A route
 * needing a record id is not a valid destination from a clause, because there
 * is no record to open — the clause knows about a subject, not about one of
 * this site's forms.
 */

const APP = join(__dirname, '..', '..', 'app');

/** Whether a route string resolves to a file expo-router would serve. */
function resolves(route: string): boolean {
  const clean = route.replace(/^\/+/, '');
  return existsSync(join(APP, `${clean}.tsx`)) || existsSync(join(APP, clean, 'index.tsx'));
}

const links = STANDARDS.flatMap((doc) =>
  doc.clauses
    .filter((c) => c.appFeature)
    .map((c) => ({ doc: doc.designation, ref: c.ref, feature: c.appFeature! })));

describe('the clause-to-screen links', () => {
  it('has some, because a catalogue that answers nothing is a list of numbers', () => {
    expect(links.length).toBeGreaterThan(20);
  });

  it('points every one at a screen the router actually has', () => {
    const dead = links.filter((l) => !resolves(l.feature));
    // Named rather than counted: a bare count tells whoever broke it nothing.
    expect(dead.map((l) => `${l.doc} ${l.ref} → ${l.feature}`)).toEqual([]);
  });

  it('never points at a screen that needs a record id', () => {
    /*
     * A clause knows about a subject, not about one of this site's records.
     * `/occupier/[id]` opened with no id is a screen with nothing in it, which
     * reads as a fault rather than as an answer.
     */
    const dynamic = links.filter((l) => l.feature.includes('['));
    expect(dynamic.map((l) => `${l.doc} ${l.ref} → ${l.feature}`)).toEqual([]);
  });

  it('writes targets without a leading slash, the way the screen pushes them', () => {
    // The library builds the href as `/${appFeature}`. A stored leading slash
    // makes `//tools/hydrant`, which resolves to nothing.
    const slashed = links.filter((l) => l.feature.startsWith('/'));
    expect(slashed.map((l) => l.feature)).toEqual([]);
  });
});

describe('what the catalogue claims to hold', () => {
  it('reproduces no clause text, only numbers, titles and our own words', () => {
    /*
     * The licensing rule, asserted structurally rather than trusted. A clause
     * carries a reference, a title, optionally what Safe QLD says it covers,
     * and optionally a screen. There is nowhere for the standard's own text to
     * live, so it cannot be added without changing the shape first.
     */
    const allowed = new Set(['ref', 'title', 'covers', 'appFeature']);
    const extra = new Set<string>();
    for (const doc of STANDARDS) {
      for (const clause of doc.clauses) {
        for (const key of Object.keys(clause)) if (!allowed.has(key)) extra.add(key);
      }
    }
    expect([...extra]).toEqual([]);
  });

  it('gives every document somewhere official to buy or read it', () => {
    // The app is a finding aid, not a substitute. A document with no link is a
    // dead end for a technician who needs the actual clause.
    const missing = STANDARDS.filter((d) => !d.officialUrl?.startsWith('http'));
    expect(missing.map((d) => d.designation)).toEqual([]);
  });

  it('never marks a document current and names a successor for it as well', () => {
    /*
     * The contradiction that matters. A superseded edition is very often the
     * right one to be reading — a building is maintained to the standard it was
     * built under — so "superseded" is a label rather than a warning, and the
     * screen shows it as one. What it must never do is show a document as
     * current while carrying the edition that replaced it, because then neither
     * field can be believed.
     *
     * A superseded document with no named successor is deliberately allowed:
     * the successor is not always known, the screen omits the line rather than
     * guessing, and a guessed successor is how somebody ends up maintaining a
     * building to the wrong edition.
     */
    const contradictory = STANDARDS.filter((d) => d.status !== 'superseded' && d.supersededBy);
    expect(contradictory.map((d) => d.designation)).toEqual([]);
  });
});
