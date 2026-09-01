import { existsSync, readFileSync } from 'fs';
import {
  PACK_MAGIC, PACK_VERSION, decodePack, decodePackBase64, encodePack, encodePackBase64, formatBytes,
} from '@/share/pack';
import { parseFfp } from '@/parsers/ampacFfp';
import type { ParsedConfig } from '@/domain/types';

/**
 * The share pack round-trip.
 *
 * A pack is how one technician hands a site to another. If it loses a device,
 * or scrambles which zone text belongs to which point, the receiver gets a site
 * that looks complete and is wrong — which is worse than a transfer that fails
 * outright. The points are dictionary-encoded into parallel arrays, so the
 * thing to prove is that every column still lines up on the way back.
 */

const META = { app: 'Safe QLD', siteName: 'Test Site', createdAt: '2026-08-31T00:00:00.000Z' };

function config(over: Partial<ParsedConfig> = {}): ParsedConfig {
  return {
    brand: 'ampac',
    siteName: 'Test Site',
    parser: 'test/1',
    warnings: [],
    panels: [{
      name: 'MAIN FIP',
      brand: 'ampac',
      zones: [
        { number: 1, text: 'LEVEL 1 EAST', unused: false },
        { number: 2, text: 'LEVEL 1 WEST', text2: 'Plant room', unused: false },
        { number: 3, text: '', unused: true },
      ],
      points: [
        { loopNumber: 1, address: 1, text: 'L1 LOBBY', deviceType: 'smoke', zoneNumber: 1, zoneText: 'LEVEL 1 EAST', unused: false },
        { loopNumber: 1, address: 2, text: 'L1 CORRIDOR', deviceType: 'heat', zoneNumber: 1, zoneText: 'LEVEL 1 EAST', unused: false },
        { loopNumber: 1, address: 3, text: '', deviceType: 'unknown', unused: true },
        { loopNumber: 2, address: 1, text: 'PLANT MCP', deviceType: 'mcp', zoneNumber: 2, zoneText: 'LEVEL 1 WEST', unused: false },
      ],
      loops: [{ number: 1, label: 'Loop 1' }, { number: 2 }],
      causeEffect: [{ cause: 'Zone 1 alarm', effect: 'Sound alarms', description: 'Level 1 east' }],
    }],
    ...over,
  } as ParsedConfig;
}

describe('round trip', () => {
  it('returns exactly what went in', () => {
    const original = config();
    const back = decodePack(encodePack({ meta: META, config: original }));
    expect(back.config).toEqual(original);
    expect(back.meta).toEqual(META);
  });

  it('keeps every point column aligned with its own point', () => {
    // The failure that matters: parallel arrays that drift by one give the
    // receiver a site where every device carries the next device's zone.
    const back = decodePack(encodePack({ meta: META, config: config() }));
    const points = back.config.panels[0]!.points;
    expect(points).toHaveLength(4);
    expect(points[0]).toMatchObject({ address: 1, text: 'L1 LOBBY', deviceType: 'smoke', zoneText: 'LEVEL 1 EAST' });
    expect(points[3]).toMatchObject({ loopNumber: 2, address: 1, text: 'PLANT MCP', deviceType: 'mcp' });
  });

  it('keeps an unused point rather than dropping it', () => {
    // The receiver decides what to hide. A pack that silently drops spare
    // addresses is not the same site.
    const back = decodePack(encodePack({ meta: META, config: config() }));
    expect(back.config.panels[0]!.points.filter((p) => p.unused)).toHaveLength(1);
  });

  it('distinguishes an empty string from an absent field', () => {
    const back = decodePack(encodePack({ meta: META, config: config() }));
    const [z1, z2, z3] = back.config.panels[0]!.zones;
    expect(z1!.text2).toBeUndefined();
    expect(z2!.text2).toBe('Plant room');
    expect(z3!.text).toBe('');
  });

  it('survives a site with no panels', () => {
    const empty = config({ panels: [] });
    expect(decodePack(encodePack({ meta: META, config: empty })).config).toEqual(empty);
  });

  it('round-trips through base64 as well as bytes', () => {
    const original = config();
    expect(decodePackBase64(encodePackBase64({ meta: META, config: original })).config).toEqual(original);
  });
});

describe('refusing a bad pack', () => {
  const good = () => encodePack({ meta: META, config: config() });

  it('rejects something that is not a pack', () => {
    expect(() => decodePack(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]))).toThrow();
  });

  it('rejects a truncated pack rather than returning half a site', () => {
    const bytes = good();
    expect(() => decodePack(bytes.slice(0, 6))).toThrow();
  });

  it('rejects a corrupted payload', () => {
    // The CRC exists for exactly this: a pack that arrives damaged must fail,
    // not import a site with a mangled device in it.
    const bytes = good();
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
    expect(() => decodePack(bytes)).toThrow();
  });

  it('names which of the two ways it was damaged', () => {
    /*
     * The check above passes without the checksum ever being reached: the body
     * is deflated, so a flipped byte at the end fails decompression first. The
     * CRC is the guard for the other case — a pack that inflates perfectly and
     * is not what was sent — and it had never run.
     *
     * They are different things to tell somebody. One is a file that arrived
     * broken; the other is a file that arrived complete and wrong.
     */
    const damagedBody = good();
    damagedBody[damagedBody.length - 1] = damagedBody[damagedBody.length - 1]! ^ 0xff;
    expect(() => decodePack(damagedBody)).toThrow(/could not be decompressed/);

    const damagedHeader = good();
    damagedHeader[6] = damagedHeader[6]! ^ 0xff;
    expect(() => decodePack(damagedHeader)).toThrow(/failed its checksum/);
  });

  it('tells a technician on an old app to update rather than showing half a site', () => {
    /*
     * Two phones on one crew, one updated and one not. The pack format carries
     * its version so the older app can say what is wrong instead of parsing
     * fields it does not know and importing a site with pieces missing.
     */
    const future = good();
    future[4] = PACK_VERSION + 1;
    expect(() => decodePack(future)).toThrow(/newer version of Safe QLD/);
    expect(() => decodePack(future)).toThrow(/Update the app/);
  });

  it('opens a pack from an older format, since those fields have not moved', () => {
    // Only a newer version is refused. Refusing an older one would strand
    // every pack made before an update for no reason.
    const bytes = good();
    expect(bytes[4]).toBe(PACK_VERSION);
    expect(() => decodePack(bytes)).not.toThrow();
  });

  it('writes the magic and version it claims to', () => {
    const bytes = good();
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe(PACK_MAGIC);
    expect(bytes[4]).toBe(PACK_VERSION);
  });
});

describe('formatting sizes', () => {
  it('reads as a person would say it', () => {
    expect(formatBytes(512)).toMatch(/512/);
    expect(formatBytes(1024 * 1024)).toMatch(/MB/i);
  });
});

/**
 * Against a real 1.7 MB site configuration when one is available locally.
 * Skipped otherwise — customer configurations are not committed.
 */
const REAL = '/tmp/ffpreader/data/input/QWP 16.02.24.ffp';
const describeReal = existsSync(REAL) ? describe : describe.skip;

describeReal('a real site', () => {
  let parsed: ParsedConfig;

  beforeAll(() => {
    parsed = parseFfp(readFileSync(REAL, 'latin1'));
  });

  it('round-trips 3,000 devices without losing one', () => {
    const back = decodePack(encodePack({ meta: META, config: parsed }));
    const before = parsed.panels[0]!;
    const after = back.config.panels[0]!;
    expect(after.points).toHaveLength(before.points.length);
    expect(after.zones).toHaveLength(before.zones.length);
    expect(after.causeEffect).toHaveLength(before.causeEffect.length);
    expect(after.points).toEqual(before.points);
  });

  it('is small enough to actually send', () => {
    // The point of the format: a site config that arrives by email rather than
    // one that bounces. This site measures 1.67 MB as an .ffp and 1.06 MB as
    // parsed JSON; the pack is 61 KB, so about eighteen times smaller than the
    // JSON and twenty-eight times smaller than the original file.
    //
    // Asserted at eight times rather than eighteen so an ordinary change in the
    // data does not fail it, while dictionary encoding or deflate silently
    // breaking still would.
    const bytes = encodePack({ meta: META, config: parsed });
    const raw = Buffer.byteLength(JSON.stringify(parsed), 'utf8');
    expect(bytes.byteLength).toBeLessThan(raw / 8);
  });
});
