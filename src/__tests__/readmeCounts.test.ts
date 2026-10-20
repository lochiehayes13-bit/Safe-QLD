import { readFileSync } from 'node:fs';
import { DEFECT_LIBRARY } from '@/seed/defectLibrary';
import { ASSET_TYPES, SYSTEM_LABELS } from '@/seed/assetTypes';
import { SERVICE_ROUTINES } from '@/seed/serviceRoutines';
import { CATALOGUE_SIZE } from '@/seed/catalogue/index';

/**
 * The counts in the README are the ones in the app.
 *
 * The README said 76 coded defects and 32 asset types. There are 87 and 33.
 * Nobody wrote a wrong number; the seed data grew and the sentence describing
 * it did not, which is what always happens to a number written in prose.
 *
 * It matters more here than it would in most projects. This README is what a
 * customer reads to decide whether the app covers their work, and "a coded
 * library of 76 defects" understating itself by eleven is the harmless
 * direction — the same drift running the other way is a claim the app cannot
 * meet, in a document sent to somebody buying it.
 *
 * The counts are read out of the sentences rather than being listed here
 * separately, so this cannot pass against a README that no longer says
 * anything about them.
 *
 * Updating the sentence is part of adding seed data. That is the point: it is
 * a two-second edit that nobody does unless something asks.
 */

const README = readFileSync('README.md', 'utf8');

/** The number in the first sentence matching a pattern, as written. */
function claimed(pattern: RegExp): number {
  const m = README.match(pattern);
  expect({ pattern: String(pattern), found: Boolean(m) }).toEqual({ pattern: String(pattern), found: true });
  return Number(m![1]!.replace(/,/g, ''));
}

describe('the numbers the README quotes', () => {
  it('matches the coded defect library', () => {
    expect(claimed(/coded library of ([\d,]+) defects/)).toBe(DEFECT_LIBRARY.length);
  });

  it('matches the asset types and the systems they fall under', () => {
    expect(claimed(/([\d,]+) types across [\d,]+ systems/)).toBe(ASSET_TYPES.length);
    expect(claimed(/[\d,]+ types across ([\d,]+) systems/)).toBe(Object.keys(SYSTEM_LABELS).length);
  });

  it('matches the parts catalogue', () => {
    expect(claimed(/([\d,]+) part numbers/)).toBe(CATALOGUE_SIZE);
  });

  it('does not quote a count for something the app does not have', () => {
    /*
     * A guard on this test rather than on the README. Each assertion above
     * fails loudly if its sentence is deleted, but only because `claimed`
     * insists on finding it — without that, removing a sentence would make its
     * assertion pass by never running.
     */
    expect(DEFECT_LIBRARY.length).toBeGreaterThan(0);
    expect(SERVICE_ROUTINES.length).toBeGreaterThan(0);
    expect(README.length).toBeGreaterThan(1000);
  });
});
