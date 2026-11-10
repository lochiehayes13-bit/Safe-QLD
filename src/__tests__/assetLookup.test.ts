import { formatTag, tagPayload } from '@/domain/assetTag';
import {
  bestMatches, identifierKeys, officeNumber, resolveScan, type AssetMatch, type IdentifierKeys,
} from '@/domain/assetLookup';

/**
 * Reading one identifier in every form the register might hold it.
 *
 * The printed label's barcode carries the tag without hyphens while the
 * register holds it with them, so a scanned label used to come back as
 * "Nothing matched". These pin the forms a scan or a typed value is turned
 * into, and the order a match is chosen in.
 */

const TAG = formatTag('detector', 1847) as string; // SQ-DET-0001847-3K
const COMPACT = TAG.replace(/-/g, '');

describe('identifierKeys', () => {
  it('reads a compact tag off a printed label as the hyphenated tag the register holds', () => {
    const keys = identifierKeys(COMPACT);
    expect(keys.exact).toContain(TAG);
    expect(keys.compact).toBe(COMPACT);
    expect(keys.problem).toBeUndefined();
  });

  it('takes the hyphenated tag, typed in lower case, the same way', () => {
    const keys = identifierKeys(` ${TAG.toLowerCase()} `);
    expect(keys.exact).toContain(TAG);
    expect(keys.compact).toBe(COMPACT);
  });

  it('also tries the pre-tag code for the same serial, which older assets still hold', () => {
    expect(identifierKeys(TAG).exact).toContain('SQ-DET-0001847');
  });

  it('unwraps a QR payload and does not compare the wrapper', () => {
    const keys = identifierKeys(tagPayload(TAG) as string);
    expect(keys.exact).toEqual([TAG, 'SQ-DET-0001847']);
    expect(keys.compact).toBe(COMPACT);
  });

  it('keeps an office asset number as typed, and stripped of its separators', () => {
    const keys = identifierKeys('ext-12');
    expect(keys.exact).toEqual(['EXT-12']);
    expect(keys.compact).toBe('EXT12');
    expect(keys.problem).toBeUndefined();
  });

  it('flags a tag that fails its check as a misread, without correcting it', () => {
    const wrong = `${TAG.slice(0, -2)}${TAG.endsWith('ZZ') ? 'YY' : 'ZZ'}`;
    const keys = identifierKeys(wrong);
    expect(keys.problem).toBe('misread');
    expect(keys.exact).not.toContain(TAG);
  });

  it('flags a label in a format this build does not know', () => {
    expect(identifierKeys(`SQFP:9:${TAG}`).problem).toBe('newer-label');
  });

  it('gives nothing to look up for blank input', () => {
    expect(identifierKeys('   ')).toEqual({ read: '', exact: [], compact: '' });
  });
});

describe('officeNumber', () => {
  it('reads assetNumber first, then the older tag key', () => {
    expect(officeNumber({ assetNumber: 'A-7', tag: 'B-8' })).toBe('A-7');
    expect(officeNumber({ tag: 'B-8' })).toBe('B-8');
    expect(officeNumber({ tag: 42 })).toBe('42');
    expect(officeNumber({ tag: '  ' })).toBeUndefined();
  });
});

interface Hit { id: string; match: AssetMatch }
interface Part { partNumber: string }

function sources(opts: { assets?: Hit[]; loose?: Hit[]; parts?: Part[] } = {}) {
  const asked: IdentifierKeys[] = [];
  return {
    asked,
    byIdentifier: async (keys: IdentifierKeys) => { asked.push(keys); return opts.assets ?? []; },
    bySerialContaining: async () => opts.loose ?? [],
    parts: async () => opts.parts ?? [],
  };
}

describe('bestMatches', () => {
  it('keeps only the best kind of match', () => {
    const hits: Hit[] = [{ id: 's', match: 'serial' }, { id: 'n', match: 'office-number' }, { id: 'c', match: 'code' }];
    expect(bestMatches(hits).map((h) => h.id)).toEqual(['c']);
    expect(bestMatches(hits.slice(0, 2)).map((h) => h.id)).toEqual(['n']);
    expect(bestMatches([])).toEqual([]);
  });
});

describe('resolveScan', () => {
  it('opens the one asset a scanned label matches, looking it up by its hyphenated tag', async () => {
    const s = sources({ assets: [{ id: 'a1', match: 'code' }] });
    expect(await resolveScan(COMPACT, s)).toEqual({ kind: 'asset', asset: { id: 'a1', match: 'code' } });
    expect(s.asked[0]!.exact).toContain(TAG);
  });

  it('prefers our tag over a serial that happens to read the same', async () => {
    const s = sources({ assets: [{ id: 'tagged', match: 'code' }, { id: 'serial', match: 'serial' }] });
    expect(await resolveScan(COMPACT, s)).toMatchObject({ kind: 'asset', asset: { id: 'tagged' } });
  });

  it('lists every asset when an office number repeats across sites', async () => {
    const s = sources({ assets: [{ id: 'x', match: 'office-number' }, { id: 'y', match: 'office-number' }] });
    expect(await resolveScan('12', s)).toEqual({
      kind: 'assets', read: '12', assets: [{ id: 'x', match: 'office-number' }, { id: 'y', match: 'office-number' }],
    });
  });

  it('falls back to a serial inside a maker barcode when exactly one asset has it', async () => {
    const s = sources({ loose: [{ id: 'm', match: 'serial' }] });
    expect(await resolveScan('SN-0099887766', s)).toMatchObject({ kind: 'asset', asset: { id: 'm' } });
  });

  it('then a catalogue part whose number is the value, ignoring separators', async () => {
    const s = sources({ parts: [{ partNumber: 'FP-901' }, { partNumber: 'FP-9010' }] });
    expect(await resolveScan('fp901', s)).toEqual({ kind: 'part', part: { partNumber: 'FP-901' } });
  });

  it('says what was read when nothing matches, and whether it was a misread label', async () => {
    expect(await resolveScan('NOPE-1', sources())).toEqual({ kind: 'none', read: 'NOPE-1', problem: undefined });
    const wrong = `${TAG.slice(0, -2)}${TAG.endsWith('ZZ') ? 'YY' : 'ZZ'}`;
    expect(await resolveScan(wrong, sources())).toMatchObject({ kind: 'none', problem: 'misread' });
  });

  it('does nothing for an empty read', async () => {
    expect(await resolveScan('  ', sources())).toBeNull();
  });
});
