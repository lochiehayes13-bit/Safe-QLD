import { searchZones } from '@/domain/zonePick';

const zone = (number: number, text: string, text2?: string) => ({ number, text, text2 });

/** A large panel: zones 1 to 200, with a few named ones. */
const PANEL = Array.from({ length: 200 }, (_, i) => {
  const n = i + 1;
  if (n === 3) return zone(3, 'Level 3 lobby');
  if (n === 12) return zone(12, 'Plant room', 'Basement');
  if (n === 175) return zone(175, 'Car park sprinkler flow');
  return zone(n, `Zone text ${n}`);
}).reverse();

const numbers = (rows: { number: number }[]) => rows.map((z) => z.number);

describe('picking a zone for a cause and effect rule', () => {
  it('reaches a zone past the sixtieth', () => {
    const found = searchZones(PANEL, '175', 8);
    expect(numbers(found.rows)[0]).toBe(175);
  });

  it('puts the exact number first, then numbers that start with it, then text', () => {
    const found = searchZones(PANEL, '12', 20);
    expect(numbers(found.rows).slice(0, 12)).toEqual([12, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 112]);
  });

  it('reads "zone 12" and "z12" as 12', () => {
    expect(numbers(searchZones(PANEL, 'Zone 12', 1).rows)).toEqual([12]);
    expect(numbers(searchZones(PANEL, 'z12', 1).rows)).toEqual([12]);
  });

  it('finds a zone by its text, in any case and word order', () => {
    expect(numbers(searchZones(PANEL, 'LOBBY', 8).rows)).toEqual([3]);
    expect(numbers(searchZones(PANEL, 'flow car', 8).rows)).toEqual([175]);
  });

  it('searches the second line of text too', () => {
    expect(numbers(searchZones(PANEL, 'basement', 8).rows)).toEqual([12]);
  });

  it('cuts at the limit and says how many matched', () => {
    const found = searchZones(PANEL, 'zone text', 8);
    expect(found.rows).toHaveLength(8);
    expect(found.matching).toBe(197);
  });

  it('with nothing typed, offers the lowest zones and counts them all', () => {
    const found = searchZones(PANEL, '  ', 5);
    expect(numbers(found.rows)).toEqual([1, 2, 3, 4, 5]);
    expect(found.matching).toBe(200);
  });

  it('finds nothing where nothing matches', () => {
    expect(searchZones(PANEL, 'loading dock', 8)).toEqual({ rows: [], matching: 0 });
  });
});
