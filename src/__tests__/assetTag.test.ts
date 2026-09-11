import {
  CHECK_SCHEME, MAX_SERIAL, MIN_SERIAL, TAG_LENGTH, TYPE_CODES,
  assetCodeFor, assetTypeForCode, auditTags, checkCharacters, checkCharactersAgree, compactTag,
  formatTag, isTagPayload, isValidTag, normalise, parseAssetCode, parseTag, planTagAssignments,
  readScannedValue, serialsInUse, tagPayload, typeCodeFor, typeCodeTableIssues,
  type TaggableAsset,
} from '@/domain/assetTag';
import {
  CODE39_PATTERNS, CODE39_SPEC, LABEL_STOCKS, MIN_NARROW_MM,
  buildLabelSheet, code39Svg, code39WidthModules, decodeCode39Widths, planBarcode, stockById,
  stockLayout,
} from '@/export/assetLabels';
import { ASSET_TYPES } from '@/seed/assetTypes';

/**
 * Tagging 12,553 assets so that one of them can be told from the next.
 *
 * Almost everything here is about the check characters, because that is the
 * only part of the scheme that can fail silently. A tag that will not parse is
 * a nuisance; a tag that parses into the wrong asset attributes a test to a
 * device that was never touched and leaves the device that was touched with a
 * gap. Both records are then wrong and nothing in the app can tell.
 *
 * So the substitution and transposition tests are exhaustive rather than
 * illustrative: every single-character misread of a sample of real-shaped
 * tags, and every adjacent swap, is generated and must be refused. If a future
 * change to the check scheme lets one through, these fail.
 */

const SAMPLE_TAGS: string[] = (() => {
  const tags: string[] = [];
  // Spread across every type code and a range of serials, including the two
  // ends, so no test is quietly passing on one lucky number.
  const serials = [1, 2, 9, 10, 42, 99, 100, 1847, 12553, 99999, 1000000, MAX_SERIAL];
  for (const [i, entry] of TYPE_CODES.entries()) {
    for (const serial of serials) {
      if ((serial + i) % 3 !== 0 && serial !== 1847) continue; // keep the run in the thousands, not tens of thousands
      const tag = formatTag(entry.assetTypeId, serial);
      if (tag) tags.push(tag);
    }
  }
  return tags;
})();

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// ---------------------------------------------------------------------------

describe('the code table', () => {
  it('covers every asset type the app can create, because an unmapped type cannot be tagged at all', () => {
    expect(typeCodeTableIssues()).toEqual([]);
    expect(TYPE_CODES).toHaveLength(ASSET_TYPES.length);
  });

  it('gives every type a three-letter code even where the asset catalogue uses two', () => {
    // The catalogue's own prefixes for these are RM, LP, SP and FD. A tag has
    // fixed-width fields so that it survives losing its hyphens, and a
    // two-letter code would shift the serial two characters left.
    expect(typeCodeFor('room')).toBe('ROM');
    expect(typeCodeFor('loop')).toBe('LOP');
    expect(typeCodeFor('sampling-point')).toBe('SMP');
    expect(typeCodeFor('fire-door')).toBe('FDR');
    for (const entry of TYPE_CODES) expect(entry.code).toMatch(/^[A-Z]{3}$/);
  });

  it('keeps the register\'s own three-letter prefix, so the old asset code survives inside the tag', () => {
    // The whole upgrade story rests on this: SQ-DET-0001847 is a leading
    // substring of SQ-DET-0001847-3K, so a 2019 report still points at the head
    // on the ceiling. Quietly coding detectors DTC instead would break that for
    // every asset of the type, and the tag would still validate perfectly.
    let checked = 0;
    for (const entry of TYPE_CODES) {
      const def = ASSET_TYPES.find((d) => d.id === entry.assetTypeId);
      expect(def).toBeDefined();
      const prefix = (def as NonNullable<typeof def>).codePrefix.toUpperCase();
      if (!/^[A-Z]{3}$/.test(prefix)) {
        expect(entry.origin).toBe('assigned-here');
        continue;
      }
      checked += 1;
      expect(entry.code).toBe(prefix);
      expect(entry.origin).toBe('asset-type-catalogue');
      const tag = formatTag(entry.assetTypeId, 1847) as string;
      expect(tag.startsWith(assetCodeFor(entry.assetTypeId, 1847) as string)).toBe(true);
    }
    // Four of the catalogue prefixes are two letters, so 29 of the 33 keep theirs.
    expect(checked).toBe(TYPE_CODES.length - 4);
  });

  it('returns nothing for a type it does not know rather than inventing three letters', () => {
    // A guessed code would collide with a real one sooner or later, and a tag
    // that decodes to the wrong kind of equipment is worse than no tag.
    expect(typeCodeFor('trebuchet')).toBeUndefined();
    expect(assetTypeForCode('ZZZ')).toBeUndefined();
  });

  it('maps a code back to exactly one asset type', () => {
    for (const entry of TYPE_CODES) {
      expect(assetTypeForCode(entry.code)?.assetTypeId).toBe(entry.assetTypeId);
    }
  });

  it('marks places and circuits as things you cannot stick a label to', () => {
    // Printing 400 labels for rooms and loops wastes a packet of stock.
    expect(TYPE_CODES.find((c) => c.assetTypeId === 'level')?.labelled).toBe(false);
    expect(TYPE_CODES.find((c) => c.assetTypeId === 'loop')?.labelled).toBe(false);
    expect(TYPE_CODES.find((c) => c.assetTypeId === 'extinguisher')?.labelled).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('check characters — ISO/IEC 7064 MOD 1271-36', () => {
  it("reproduces the standard's own worked example", () => {
    // ISO79 with its two check characters is ISO793W. Getting this right is
    // the difference between implementing the standard and implementing
    // something that merely resembles it.
    expect(checkCharacters('ISO79')).toBe('3W');
    expect(checkCharactersAgree('ISO793W')).toBe(true);
    expect(CHECK_SCHEME.characters).toBe(2);
  });

  it('refuses to compute over a string containing anything outside 0-9 A-Z', () => {
    // Skipping the offending character would produce a check that validates a
    // string nobody ever wrote.
    expect(checkCharacters('SQ-DET-0001847')).toBeUndefined();
    expect(checkCharacters('sqdet0001847')).toBeUndefined();
  });

  it('rejects every single-character substitution in every sample tag', () => {
    // The whole reason the scheme exists: one wrong character must not resolve
    // to a different, real asset.
    let checked = 0;
    for (const tag of SAMPLE_TAGS) {
      const compact = compactTag(tag);
      for (let i = 0; i < compact.length; i += 1) {
        for (const ch of ALPHABET) {
          if (ch === compact[i]) continue;
          const wrong = compact.slice(0, i) + ch + compact.slice(i + 1);
          checked += 1;
          if (parseTag(wrong).ok) {
            throw new Error(`${wrong} was accepted; it is a one-character misread of ${tag}`);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(10_000);
  });

  it('rejects every adjacent transposition in every sample tag', () => {
    // Swapping two neighbouring digits is the single most common way a person
    // mis-copies a number off a label.
    let checked = 0;
    for (const tag of SAMPLE_TAGS) {
      const compact = compactTag(tag);
      for (let i = 0; i + 1 < compact.length; i += 1) {
        if (compact[i] === compact[i + 1]) continue; // swapping two identical characters is not an error
        const wrong = compact.slice(0, i) + compact[i + 1] + compact[i] + compact.slice(i + 2);
        checked += 1;
        if (parseTag(wrong).ok) {
          throw new Error(`${wrong} was accepted; it is ${tag} with two characters swapped`);
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it('blames the check characters, not the shape, when only the digits change', () => {
    // A substitution inside the serial leaves a perfectly well-formed tag. If
    // these came back as "malformed" the format rules would be doing the work
    // and the check characters could be broken without anyone noticing.
    const serialStart = 5;
    for (const tag of SAMPLE_TAGS.slice(0, 30)) {
      const compact = compactTag(tag);
      for (let i = serialStart; i < serialStart + 7; i += 1) {
        for (const digit of '0123456789') {
          if (digit === compact[i]) continue;
          const wrong = compact.slice(0, i) + digit + compact.slice(i + 1);
          const result = parseTag(wrong);
          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.reason).toBe('check-failed');
        }
      }
    }
  });

  it('rejects jump transpositions and twin errors as well', () => {
    // Not required of the scheme, but it does catch them, and a regression that
    // lost the property would be worth knowing about.
    for (const tag of SAMPLE_TAGS) {
      const compact = compactTag(tag);
      for (let i = 0; i + 2 < compact.length; i += 1) {
        if (compact[i] === compact[i + 2]) continue;
        const jumped = compact.slice(0, i) + compact[i + 2] + compact[i + 1] + compact[i] + compact.slice(i + 3);
        expect(parseTag(jumped).ok).toBe(false);
      }
      for (let i = 0; i + 1 < compact.length; i += 1) {
        if (compact[i] !== compact[i + 1]) continue;
        for (const ch of ALPHABET) {
          if (ch === compact[i]) continue;
          expect(parseTag(compact.slice(0, i) + ch + ch + compact.slice(i + 2)).ok).toBe(false);
        }
      }
    }
  });

  it('would have been let down by the single-character scheme it replaced', () => {
    // ISO 7064 MOD 37,36 is the obvious choice and produces one check
    // character instead of two. It catches every substitution but not every
    // transposition, and this is a real example of what it would wave through:
    // SQEXT0000120T read as SQEXT0000210T — extinguisher 120 attributed to
    // extinguisher 210. Both are real assets. Nothing downstream could tell.
    const mod3736 = (body: string): string => {
      let c = 18;
      for (const ch of body) {
        c = ((c || 36) * 2) % 37;
        c = (c + ALPHABET.indexOf(ch)) % 36;
      }
      const doubled = ((c || 36) * 2) % 37;
      return ALPHABET[(((1 - doubled) % 36) + 36) % 36] as string;
    };
    const agrees = (full: string): boolean => mod3736(full.slice(0, -1)) === full.slice(-1);

    expect(agrees('SQEXT0000120T')).toBe(true);
    expect(agrees('SQEXT0000210T')).toBe(true); // the transposition, accepted

    // The scheme actually in use refuses it.
    const real = formatTag('extinguisher', 120);
    expect(real).toBeDefined();
    const swapped = compactTag(real as string).replace('0000120', '0000210');
    expect(parseTag(swapped).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('formatting a tag', () => {
  it('builds the number that goes on the sticker', () => {
    expect(formatTag('detector', 1847)).toBe('SQ-DET-0001847-3K');
    expect(formatTag('extinguisher', 1)).toBe('SQ-EXT-0000001-NJ');
  });

  it('keeps the pre-tag asset code the register already holds', () => {
    // SQ-DET-0001847 appears in reports issued years ago. The tag is that
    // number plus its check, not a new number.
    const parsed = parseTag('SQ-DET-0001847-3K');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.assetCode).toBe('SQ-DET-0001847');
  });

  it('refuses a serial outside the range instead of wrapping or padding it', () => {
    expect(formatTag('detector', 0)).toBeUndefined();
    expect(formatTag('detector', -1)).toBeUndefined();
    expect(formatTag('detector', MAX_SERIAL + 1)).toBeUndefined();
    expect(formatTag('detector', 12.5)).toBeUndefined();
  });

  it('uses both ends of the range it advertises', () => {
    /*
     * The range was tested only from outside — nought and one past the top.
     * Excluding its own last number would take seven-digit numbering down to
     * 9,999,998 usable tags with nothing saying so, and the failure only shows
     * up when the register reaches the end of a type.
     */
    for (const serial of [MIN_SERIAL, MAX_SERIAL]) {
      const tag = formatTag('detector', serial);
      expect(tag).toBeDefined();
      // Round-tripped rather than written out, so the check characters are the
      // ones the scheme produces and not the ones a test author expected.
      expect(parseTag(tag!)).toMatchObject({ ok: true, serial, assetTypeId: 'detector' });
    }
    expect(assetCodeFor('detector', MIN_SERIAL)).toBe('SQ-DET-0000001');
    expect(assetCodeFor('detector', MAX_SERIAL)).toBe('SQ-DET-9999999');
  });

  it('refuses a type it has no code for rather than guessing one', () => {
    expect(formatTag('trebuchet', 1)).toBeUndefined();
  });

  it('round-trips every tag it builds', () => {
    for (const tag of SAMPLE_TAGS) {
      const parsed = parseTag(tag);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(formatTag(parsed.assetTypeId, parsed.serial)).toBe(tag);
    }
  });
});

// ---------------------------------------------------------------------------

describe('parsing tolerantly', () => {
  it('accepts what a tired technician actually types', () => {
    const expected = 'SQ-DET-0001847-3K';
    for (const input of [
      'sq-det-0001847-3k',
      'SQDET00018473K',
      ' SQ DET 0001847 3K ',
      'SQ--DET--0001847--3K',
      'sq det0001847-3k',
      'SQ.DET.0001847.3K',
    ]) {
      const parsed = parseTag(input);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.tag).toBe(expected);
    }
  });

  it('accepts the separator-free form the barcode carries', () => {
    // The label prints hyphens for a human; Code 39 spends a whole character on
    // each one, so the barcode leaves them out.
    expect(isValidTag(compactTag('SQ-DET-0001847-3K'))).toBe(true);
  });

  it("does not 'helpfully' fold O to 0 or I to 1", () => {
    // The fold looks kind and destroys the only defence there is: a misread
    // corrected before the check runs is a misread the check can never catch.
    expect(normalise('SQ-DET-OOO1847-3K')).toBe('SQDETOOO18473K');
    expect(parseTag('SQ-DET-OOO1847-3K').ok).toBe(false);
    expect(parseTag('SQ-DET-000I847-3K').ok).toBe(false);
  });

  it('rejects a tag buried in other text rather than fishing it out', () => {
    // "Asset SQ-DET-0001847-3K on level 3" could just as easily contain two
    // numbers, and picking one would be a guess.
    expect(parseTag('Asset SQ-DET-0001847-3K on level 3').ok).toBe(false);
  });
});

describe('validating strictly', () => {
  it('says nothing was read when nothing was read', () => {
    const result = parseTag('   ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('empty');
  });

  it('names another contractor\'s label rather than blaming the technician', () => {
    const result = parseTag('AB-DET-0001847-3K');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('wrong-prefix');
  });

  it('tells the technician which characters they missed off the end', () => {
    const result = parseTag('SQ-DET-0001847-3');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('wrong-length');
      expect(result.message).toContain(String(TAG_LENGTH));
    }
  });

  it('recognises a pre-tag asset code as unverifiable rather than as rubbish', () => {
    // These are all over the register and all over old reports. Told apart from
    // a genuine misread so the app can offer to upgrade them.
    const result = parseTag('SQ-DET-0001847');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('missing-check');
      expect(result.message).toContain('SQ-DET-0001847');
    }
  });

  it('reports a code from a newer app version as exactly that', () => {
    // Internally consistent but unknown: this is a tag we did not print, not a
    // misread, and telling a technician to re-read a correct label wastes a
    // trip up the ladder.
    const body = 'SQZZZ0001847';
    const check = checkCharacters(body);
    expect(check).toBeDefined();
    const result = parseTag(body + (check as string));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unknown-type-code');
  });

  it('refuses serial zero, which this app never issues', () => {
    const body = 'SQDET0000000';
    const result = parseTag(body + (checkCharacters(body) as string));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('zero-serial');
  });

  it('never offers the check characters it expected', () => {
    // Deliberate. Shown a correction, a technician takes it — and the
    // correction assumes the seven digits are right and the check is wrong,
    // which is backwards. The only safe advice is to read the label again.
    const result = parseTag('SQ-DET-0001847-XX');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('check-failed');
      expect(result.message).not.toContain('3K');
      expect(Object.values(result)).not.toContain('3K');
    }
  });
});

// ---------------------------------------------------------------------------

describe('pre-tag asset codes', () => {
  it('reads the codes the register already holds, including the two-letter prefixes', () => {
    expect(parseAssetCode('SQ-DET-0001847')).toMatchObject({ assetTypeId: 'detector', serial: 1847 });
    expect(parseAssetCode('SQ-FD-0000012')).toMatchObject({ assetTypeId: 'fire-door', serial: 12 });
    expect(parseAssetCode('SQ-SP-0000007')).toMatchObject({ assetTypeId: 'sampling-point', serial: 7 });
  });

  it('does not confuse SP with SPR or SPK', () => {
    // Exactly seven digits after the prefix is what keeps this unambiguous.
    expect(parseAssetCode('SQ-SPR-0000007')?.assetTypeId).toBe('sprinkler-head');
    expect(parseAssetCode('SQ-SPK-0000007')?.assetTypeId).toBe('speaker');
  });

  it('does not read a full tag as a code plus two stray characters', () => {
    expect(parseAssetCode('SQ-DET-0001847-3K')).toBeUndefined();
  });

  it('proposes the tag that keeps the number, so old paperwork still matches', () => {
    // A 2019 report cites SQ-DET-0001847. Issuing a fresh serial would break
    // the link between that report and the head on the ceiling.
    expect(parseAssetCode('SQ-DET-0001847')?.proposedTag).toBe('SQ-DET-0001847-3K');
    expect(parseAssetCode('SQ-FD-0000012')?.proposedTag).toBe(formatTag('fire-door', 12));
  });

  it('builds the code the asset repository would have built', () => {
    expect(assetCodeFor('detector', 1847)).toBe('SQ-DET-0001847');
    expect(assetCodeFor('fire-door', 12)).toBe('SQ-FD-0000012');
    expect(assetCodeFor('trebuchet', 1)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe('what the code carries', () => {
  it('encodes a payload that resolves without a server', () => {
    // A URL on 12,553 labels is a twenty-year promise made to a phone standing
    // in a basement pump room with no signal.
    expect(tagPayload('SQ-DET-0001847-3K')).toBe('SQFP:1:SQ-DET-0001847-3K');
    expect(tagPayload('SQ-DET-0001847-3K')).not.toContain('http');
  });

  it('will not wrap a tag that does not validate', () => {
    expect(tagPayload('SQ-DET-0001847-XX')).toBeUndefined();
  });

  it('recognises its own payloads without judging the tag inside', () => {
    expect(isTagPayload('SQFP:1:SQ-DET-0001847-3K')).toBe(true);
    expect(isTagPayload('sqfp:1:anything')).toBe(true);
    expect(isTagPayload('https://example.com/SQ-DET-0001847-3K')).toBe(false);
    expect(isTagPayload('SQ-DET-0001847-3K')).toBe(false);
  });

  it('refuses a payload from a format it does not understand, and says that is what happened', () => {
    // A later format might put something else after the second colon. Reading
    // it as a tag would be a guess. The reason has to be its own, not
    // 'wrong-length': a caller switching on it must be able to send this
    // technician to the office for an app update rather than back up the ladder
    // to re-read a label that is perfectly correct.
    const reading = readScannedValue('SQFP:2:SQ-DET-0001847-3K');
    expect(reading.kind).toBe('unrecognised');
    if (reading.kind === 'unrecognised') {
      expect(reading.rejection.message).toContain('format 2');
      expect(reading.rejection.reason).toBe('future-format');
      expect(reading.rejection.reason).not.toBe('wrong-length');
    }
  });
});

describe('reading whatever the camera produced', () => {
  it('takes a payload, a bare tag or an old asset code and says which it got', () => {
    const payload = readScannedValue('SQFP:1:SQ-DET-0001847-3K');
    expect(payload.kind).toBe('tag');
    if (payload.kind === 'tag') expect(payload.fromPayload).toBe(true);

    const bare = readScannedValue('SQDET00018473K');
    expect(bare.kind).toBe('tag');
    if (bare.kind === 'tag') expect(bare.fromPayload).toBe(false);

    const legacy = readScannedValue('SQ-DET-0001847');
    expect(legacy.kind).toBe('asset-code');
    if (legacy.kind === 'asset-code') expect(legacy.code.serial).toBe(1847);
  });

  it('hands back a reason a technician can act on when it recognises nothing', () => {
    const reading = readScannedValue('4901234567894');
    expect(reading.kind).toBe('unrecognised');
    if (reading.kind === 'unrecognised') expect(reading.rejection.message.length).toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------------------

describe('auditing a site', () => {
  const assets: TaggableAsset[] = [
    { id: 'a1', assetTypeId: 'detector', code: 'SQ-DET-0001847-3K', name: 'Ward 3 head' },
    { id: 'a2', assetTypeId: 'detector', code: '', name: 'Ward 4 head' },
    { id: 'a3', assetTypeId: 'extinguisher', code: 'SQ-EXT-0000042', name: 'Corridor ABE' },
    { id: 'a4', assetTypeId: 'extinguisher', code: 'EXT-42-CORRIDOR', name: 'Corridor ABE 2' },
    { id: 'a5', assetTypeId: 'trebuchet', code: null, name: 'Whatever this is' },
  ];

  it('separates what can be trusted from what needs looking at', () => {
    const audit = auditTags(assets);
    expect(audit.tagged.map((r) => r.asset.id)).toEqual(['a1']);
    expect(audit.untagged.map((r) => r.asset.id)).toEqual(['a2', 'a5']);
    expect(audit.upgradeable.map((r) => r.asset.id)).toEqual(['a3']);
    expect(audit.invalid.map((r) => r.asset.id)).toEqual(['a4']);
  });

  it('says why an untagged asset cannot simply be tagged', () => {
    const audit = auditTags(assets);
    const blocked = audit.untagged.find((r) => r.asset.id === 'a5');
    expect(blocked?.blocker).toContain('no tag code');
    expect(audit.untagged.find((r) => r.asset.id === 'a2')?.blocker).toBeUndefined();
  });

  it('finds the same number worn once as a tag and once as the old code it upgrades from', () => {
    // The two are the same serial on two devices, and one of them has already
    // been re-labelled. Comparing only the tagged assets reports the site clean
    // right up until the moment 400 labels are printed.
    const audit = auditTags([
      { id: 'new', assetTypeId: 'extinguisher', code: 'SQ-EXT-0000042-SR' },
      { id: 'old', assetTypeId: 'extinguisher', code: 'SQ-EXT-0000042' },
    ]);
    expect(audit.duplicates).toHaveLength(1);
    expect(audit.duplicates[0]?.tag).toBe('SQ-EXT-0000042-SR');
    expect(audit.duplicates[0]?.assets.map((a) => a.id)).toEqual(['new', 'old']);
  });

  it('finds two assets wearing the same tag, which no check character can catch', () => {
    // Each tag is individually perfect. Only comparing them across the site
    // shows the problem, and it is the worst one there is: a scan is then
    // ambiguous with nothing to break the tie.
    const audit = auditTags([
      ...assets,
      { id: 'a6', assetTypeId: 'detector', code: 'SQ-DET-0001847-3K', name: 'Ward 9 head' },
    ]);
    expect(audit.duplicates).toHaveLength(1);
    expect(audit.duplicates[0]?.tag).toBe('SQ-DET-0001847-3K');
    expect(audit.duplicates[0]?.assets.map((a) => a.id)).toEqual(['a1', 'a6']);
  });
});

// ---------------------------------------------------------------------------

describe('issuing tags in bulk', () => {
  it('numbers untagged assets from the serial the database supplies', () => {
    const plan = planTagAssignments(
      [
        { id: 'a1', assetTypeId: 'detector' },
        { id: 'a2', assetTypeId: 'detector' },
        { id: 'a3', assetTypeId: 'extinguisher' },
      ],
      { detector: 1848, extinguisher: 43 },
    );
    expect(plan.assignments.map((a) => a.tag)).toEqual([
      formatTag('detector', 1848), formatTag('detector', 1849), formatTag('extinguisher', 43),
    ]);
    expect(plan.nextSerials).toMatchObject({ detector: 1850, extinguisher: 44 });
  });

  it('leaves an asset that already has a valid tag exactly as it is', () => {
    // Re-tagging it would orphan the sticker physically on the device.
    const plan = planTagAssignments(
      [{ id: 'a1', assetTypeId: 'detector', code: 'SQ-DET-0001847-3K' }],
      { detector: 5000 },
    );
    expect(plan.assignments).toEqual([]);
    expect(plan.skipped[0]?.reason).toContain('Already tagged SQ-DET-0001847-3K');
  });

  it('upgrades an old code in place and does not spend a new serial on it', () => {
    const plan = planTagAssignments(
      [
        { id: 'a1', assetTypeId: 'extinguisher', code: 'SQ-EXT-0000042' },
        { id: 'a2', assetTypeId: 'extinguisher' },
      ],
      { extinguisher: 900 },
    );
    expect(plan.assignments[0]).toMatchObject({
      assetId: 'a1', serial: 42, keptExistingNumber: true, tag: formatTag('extinguisher', 42),
    });
    expect(plan.assignments[1]).toMatchObject({ assetId: 'a2', serial: 900, keptExistingNumber: false });
  });

  it('refuses to renumber an asset whose existing code makes no sense', () => {
    // Something is stuck to that device and nobody knows what. Issuing a new
    // number quietly leaves a label in the field pointing at a number the
    // register no longer uses, which is worse than the problem it fixes.
    const plan = planTagAssignments(
      [{ id: 'a1', assetTypeId: 'detector', code: 'DET-1847-WARD3' }],
      { detector: 5000 },
    );
    expect(plan.assignments).toEqual([]);
    expect(plan.skipped[0]?.reason).toContain('Check the physical label');
  });

  it('refuses when the record and the label disagree about what the asset is', () => {
    const plan = planTagAssignments(
      [{ id: 'a1', assetTypeId: 'detector', code: 'SQ-EXT-0000042' }],
      { detector: 5000 },
    );
    expect(plan.assignments).toEqual([]);
    expect(plan.skipped[0]?.reason).toContain('different kind of equipment');
  });

  it('will not start numbering at 1 when nobody told it where the numbering is up to', () => {
    // Starting at 1 would collide with a decade of existing asset codes, and
    // every collision is two devices sharing an identity.
    const plan = planTagAssignments([{ id: 'a1', assetTypeId: 'detector' }], {});
    expect(plan.assignments).toEqual([]);
    expect(plan.skipped[0]?.reason).toContain('No starting number was supplied');
  });

  it('skips a type with no code rather than tagging it wrongly', () => {
    const plan = planTagAssignments([{ id: 'a1', assetTypeId: 'trebuchet' }], { trebuchet: 1 });
    expect(plan.assignments).toEqual([]);
    expect(plan.skipped[0]?.reason).toContain('no tag code');
  });

  it('steps over a serial an upgrade in the same batch has already claimed', () => {
    // The upgraded asset keeps 900; the new one must not be given it as well.
    const plan = planTagAssignments(
      [
        { id: 'a1', assetTypeId: 'extinguisher', code: 'SQ-EXT-0000900' },
        { id: 'a2', assetTypeId: 'extinguisher' },
      ],
      { extinguisher: 900 },
    );
    const tags = plan.assignments.map((a) => a.tag);
    expect(new Set(tags).size).toBe(2);
    expect(plan.assignments[1]?.serial).toBe(901);
  });

  it('lets the asset that already wears a number keep it, whichever order the batch arrives in', () => {
    // The screen lists untagged assets first and upgradeable ones after them,
    // so the asset with a decade of paperwork behind its number is the one that
    // asks for it last. Allocating in list order would hand SQ-EXT-0000900 to a
    // brand new asset and then refuse the one whose sticker already says 900,
    // leaving a physical label in the field pointing at nothing.
    const plan = planTagAssignments(
      [
        { id: 'fresh', assetTypeId: 'extinguisher' },
        { id: 'existing', assetTypeId: 'extinguisher', code: 'SQ-EXT-0000900' },
      ],
      { extinguisher: 900 },
    );
    const existing = plan.assignments.find((a) => a.assetId === 'existing');
    expect(existing).toMatchObject({ serial: 900, keptExistingNumber: true });
    expect(plan.assignments.find((a) => a.assetId === 'fresh')?.serial).toBe(901);
    expect(plan.skipped).toEqual([]);
    expect(new Set(plan.assignments.map((a) => a.tag)).size).toBe(2);
  });

  it('stops at the end of a seven-digit serial instead of printing an eight-digit tag', () => {
    const plan = planTagAssignments([{ id: 'a1', assetTypeId: 'detector' }], { detector: MAX_SERIAL + 1 });
    expect(plan.assignments).toEqual([]);
    expect(plan.skipped[0]?.reason).toContain(String(MAX_SERIAL));
  });

  it('never issues the same tag twice in one batch', () => {
    const many: TaggableAsset[] = Array.from({ length: 250 }, (_, i) => ({
      id: `a${i}`,
      assetTypeId: i % 2 ? 'detector' : 'extinguisher',
    }));
    const plan = planTagAssignments(many, { detector: 1, extinguisher: 1 });
    expect(plan.assignments).toHaveLength(250);
    expect(new Set(plan.assignments.map((a) => a.tag)).size).toBe(250);
    for (const assignment of plan.assignments) expect(isValidTag(assignment.tag)).toBe(true);
  });
});

describe('serialsInUse', () => {
  it('starts one past the highest number it can see', () => {
    const next = serialsInUse([
      { id: 'a1', assetTypeId: 'detector', code: 'SQ-DET-0001847-3K' },
      { id: 'a2', assetTypeId: 'detector', code: 'SQ-DET-0000005' },
      { id: 'a3', assetTypeId: 'extinguisher', code: null },
    ]);
    expect(next).toEqual({ detector: 1848 });
  });
});

// ---------------------------------------------------------------------------

describe('the Code 39 table', () => {
  /**
   * The table rebuilt from the symbology's construction rather than from the
   * table.
   *
   * USS-39 Table 2 is not an arbitrary list. The five bars carry a two-of-five
   * code with the familiar weights 1, 2, 4, 7 and a parity position, so the two
   * wide bars sum to the character's position 1..9 within its block, with the
   * bars for 0 (positions 3 and 4, summing to 11) standing in for the tenth.
   * The single wide space then selects the block: the second space gives the
   * digits, the third the letters A-J, the fourth K-T, and the first U-Z and
   * the punctuation. The four patterns with no wide bar at all are $ / + %.
   *
   * Spot-checked against the specification's own binary columns before being
   * relied on here: character 1 is bars 10001 spaces 0100, N is 00101 / 0001,
   * U is 10001 / 1000, and $ is 00000 / 1110 — all four fall out of the rule.
   */
  const derivePatterns = (): Record<string, string> => {
    const WEIGHTS = [1, 2, 4, 7, 0];
    const barsFor = (position: number): number[] => {
      if (position === 10) return [2, 3]; // the tenth character, weights 4 + 7
      for (let i = 0; i < 5; i += 1) {
        for (let j = i + 1; j < 5; j += 1) {
          if ((WEIGHTS[i] as number) + (WEIGHTS[j] as number) === position) return [i, j];
        }
      }
      throw new Error(`no two-of-five pair sums to ${position}`);
    };
    const draw = (wideBars: number[], wideSpaces: number[]): string => {
      const p = 'nnnnnnnnn'.split('');
      for (const b of wideBars) p[b * 2] = 'w';
      for (const sp of wideSpaces) p[sp * 2 + 1] = 'w';
      return p.join('');
    };

    const out: Record<string, string> = {};
    const blocks: [number, string][] = [
      [1, '1234567890'],
      [2, 'ABCDEFGHIJ'],
      [3, 'KLMNOPQRST'],
      [0, 'UVWXYZ-. *'],
    ];
    for (const [space, chars] of blocks) {
      for (let i = 0; i < chars.length; i += 1) out[chars[i] as string] = draw(barsFor(i + 1), [space]);
    }
    for (const [ch, spaces] of [['$', [0, 1, 2]], ['/', [0, 1, 3]], ['+', [0, 2, 3]], ['%', [1, 2, 3]]] as [string, number[]][]) {
      out[ch] = draw([], spaces);
    }
    return out;
  };

  it('gives every character the pattern the symbology assigns it, row by row', () => {
    // Row by row, and not as a set. Swapping the rows for "0" and "1" leaves
    // the set of 44 patterns exactly as it was, so a set-equality check passes
    // while every barcode printed encodes a different string from the number
    // printed beside it — and the decoder cannot notice, because it reads the
    // same table. This is the assertion that catches it.
    const derived = derivePatterns();
    expect(Object.keys(derived)).toHaveLength(44);
    for (const [ch, pattern] of Object.entries(derived)) {
      expect(`${ch}=${CODE39_PATTERNS[ch]}`).toBe(`${ch}=${pattern}`);
    }
    expect(Object.keys(CODE39_PATTERNS).sort()).toEqual(Object.keys(derived).sort());
  });

  it('is 44 distinct patterns of nine elements with three wide, as the name says', () => {
    const patterns = Object.values(CODE39_PATTERNS);
    expect(patterns).toHaveLength(44);
    expect(new Set(patterns).size).toBe(44);
    for (const p of patterns) {
      expect(p).toHaveLength(9);
      expect([...p].filter((e) => e === 'w')).toHaveLength(3);
    }
  });
});

describe('rendering the barcode', () => {
  const L7160 = stockById('l7160');

  it('sizes the symbol so the narrow bar stays printable and readable', () => {
    expect(L7160).toBeDefined();
    const plan = planBarcode(TAG_LENGTH, (L7160 as NonNullable<typeof L7160>).labelWidthMm - 6, 16);
    expect(plan).toBeDefined();
    expect(plan?.ratio).toBe(3);
    expect(plan?.narrowMm).toBeGreaterThanOrEqual(MIN_NARROW_MM);
  });

  it('refuses to draw one at all rather than draw one too small to scan', () => {
    // A symbol below the readable module width looks like a working barcode
    // and scans like a smudge. A technician who learns the barcodes here do
    // not work stops trying to scan any of them.
    expect(planBarcode(TAG_LENGTH, 20, 16)).toBeUndefined();
  });

  it('refuses data the symbology cannot carry instead of dropping a character', () => {
    // A barcode encoding something other than the number printed beside it is
    // the exact failure the whole module exists to prevent.
    const plan = planBarcode(TAG_LENGTH, 57.5, 16);
    expect(plan).toBeDefined();
    expect(code39Svg('SQFP:1:SQDET', plan as NonNullable<typeof plan>)).toBeUndefined();
    expect(code39Svg('SQ*DET', plan as NonNullable<typeof plan>)).toBeUndefined();
  });

  it('gives the symbol the clear space the specification asks for, which does not scale with the module', () => {
    // The quiet zone is the greater of ten narrow elements and 2.54 mm, and on
    // a 63.5 mm label the fixed figure is the one that binds: ten modules of a
    // 0.21 mm element is 2.09 mm, half a millimetre short at each end. Nothing
    // about the printed symbol looks wrong, and it is the most ordinary reason
    // a well-formed barcode will not read.
    const plan = planBarcode(TAG_LENGTH, 57.5, 16);
    expect(plan).toBeDefined();
    const p = plan as NonNullable<typeof plan>;
    expect(p.quietZoneMm).toBeGreaterThanOrEqual(CODE39_SPEC.quietZoneMinMm);
    expect(p.quietZoneMm).toBeGreaterThanOrEqual(CODE39_SPEC.quietZoneModules * p.narrowMm);
    expect(p.narrowMm * CODE39_SPEC.quietZoneModules).toBeLessThan(CODE39_SPEC.quietZoneMinMm);
  });

  it('still fits the symbol, quiet zones and all, inside the space it was given', () => {
    // The quiet zone comes out of the label, not out of the margin next to it.
    // A symbol that overflows its cell is clipped by the sheet's own overflow
    // rule, and a clipped quiet zone is a barcode that does not read.
    for (const width of [57.5, 93.1, 60, 70]) {
      const plan = planBarcode(TAG_LENGTH, width, 16);
      if (!plan) continue;
      const svg = code39Svg(compactTag('SQ-DET-0001847-3K'), plan) as string;
      const drawn = Number(/width="([\d.]+)mm"/.exec(svg)?.[1]);
      expect(drawn).toBeLessThanOrEqual(width + 0.01);
      expect(drawn).toBeGreaterThan(width - 0.5);
    }
  });

  it('counts modules the way the symbology does', () => {
    // 16 characters (14 plus start and stop) at 3:1, two quiet zones.
    expect(code39WidthModules(16, 3)).toBe(10 * 2 + 16 * 15 + 15);
  });

  it('decodes back to the tag it was given', () => {
    // The only honest proof that the renderer works: measure the bars and gaps
    // off the drawing and see whether the original string comes back.
    const plan = planBarcode(TAG_LENGTH, 57.5, 16);
    expect(plan).toBeDefined();
    const data = compactTag('SQ-DET-0001847-3K');
    const svg = code39Svg(data, plan as NonNullable<typeof plan>);
    expect(svg).toBeDefined();
    expect(decodeCode39Widths(
      elementWidths(svg as string),
      (plan as NonNullable<typeof plan>).narrowMm,
      (plan as NonNullable<typeof plan>).ratio,
    )).toBe(data);
  });

  it('draws five bars for every character, start and stop included', () => {
    const plan = planBarcode(TAG_LENGTH, 57.5, 16) as NonNullable<ReturnType<typeof planBarcode>>;
    const svg = code39Svg(compactTag('SQ-DET-0001847-3K'), plan) as string;
    expect([...svg.matchAll(/<rect /g)]).toHaveLength((TAG_LENGTH + 2) * 5);
  });
});

/** Bar and space widths, in millimetres, read back off a rendered symbol. */
function elementWidths(svg: string): number[] {
  const rects = [...svg.matchAll(/<rect x="([\d.]+)" y="0" width="([\d.]+)"/g)]
    .map((m) => ({ x: Number(m[1]), w: Number(m[2]) }));
  const widths: number[] = [];
  for (let i = 0; i < rects.length; i += 1) {
    const bar = rects[i] as { x: number; w: number };
    widths.push(bar.w);
    const next = rects[i + 1];
    if (next) widths.push(next.x - (bar.x + bar.w));
  }
  return widths;
}

// ---------------------------------------------------------------------------

describe('the label sheet', () => {
  const stock = stockById('l7160') as NonNullable<ReturnType<typeof stockById>>;

  const label = (tag: string) => ({
    tag,
    typeLabel: 'Fire extinguisher',
    location: 'Level 3 · Plant room',
    siteName: 'Brisbane Private',
  });

  it('centres the block of labels the way the die is cut', () => {
    // Reproduces the published L7160 figures without quoting them, which is
    // the check that the geometry is right rather than copied.
    const layout = stockLayout(stock);
    expect(layout.leftMarginMm).toBeCloseTo(7.25, 2);
    expect(layout.topMarginMm).toBeCloseTo(15.15, 2);
    expect(layout.perSheet).toBe(21);
  });

  it('carries the tag, what the thing is, where it is and whose building it is in', () => {
    const sheet = buildLabelSheet([label('SQ-EXT-0000042-SR')], { stock });
    expect(sheet.printed).toBe(1);
    expect(sheet.html).toContain('SQ-EXT-0000042-SR');
    expect(sheet.html).toContain('Fire extinguisher');
    expect(sheet.html).toContain('Level 3 · Plant room');
    expect(sheet.html).toContain('Brisbane Private');
  });

  it('fills a sheet before starting another', () => {
    const labels = Array.from({ length: 22 }, (_, i) => label(formatTag('extinguisher', i + 1) as string));
    const sheet = buildLabelSheet(labels, { stock });
    expect(sheet.sheets).toBe(2);
    expect(sheet.printed).toBe(22);
  });

  it('starts partway down a part-used sheet, because that is the state of every label packet', () => {
    const labels = Array.from({ length: 18 }, (_, i) => label(formatTag('extinguisher', i + 1) as string));
    const sheet = buildLabelSheet(labels, { stock, startAt: 5 });
    expect(sheet.sheets).toBe(2); // 4 skipped + 18 printed is 22 positions
    expect(sheet.warnings).toEqual([]);
  });

  it('says so and starts at the top when the start position is off the sheet', () => {
    const sheet = buildLabelSheet([label('SQ-EXT-0000042-SR')], { stock, startAt: 40 });
    expect(sheet.sheets).toBe(1);
    expect(sheet.warnings[0]).toContain('outside the 1 to 21');
  });

  it('will not print a tag that does not validate, and reports each one', () => {
    // Printing an unverifiable number onto adhesive and sticking it to a fire
    // asset makes a bad record permanent, physical and undated.
    const sheet = buildLabelSheet(
      [label('SQ-EXT-0000042-SR'), label('SQ-EXT-0000042-ZZ'), label('scribble')],
      { stock },
    );
    expect(sheet.printed).toBe(1);
    expect(sheet.omitted).toHaveLength(2);
    expect(sheet.omitted[0]?.tag).toBe('SQ-EXT-0000042-ZZ');
    expect(sheet.omitted[0]?.reason).toContain('does not check out');
    expect(sheet.html).not.toContain('0000042-ZZ');
  });

  it('prints the number alone on stock too narrow for a readable barcode, and says why', () => {
    const small = stockById('l7651') as NonNullable<ReturnType<typeof stockById>>;
    const sheet = buildLabelSheet([label('SQ-EXT-0000042-SR')], { stock: small });
    expect(sheet.barcode.rendered).toBe(false);
    expect(sheet.barcode.reason).toContain('narrow bar');
    expect(sheet.html).toContain('SQ-EXT-0000042-SR');
    expect(sheet.html).not.toContain('<rect');
    expect(sheet.warnings.join(' ')).toContain('Use wider stock');
  });

  it('puts a scannable barcode on stock that has room for one', () => {
    const sheet = buildLabelSheet([label('SQ-EXT-0000042-SR')], { stock });
    expect(sheet.barcode.rendered).toBe(true);
    expect(sheet.barcode.narrowMm).toBeGreaterThanOrEqual(MIN_NARROW_MM);
    expect(sheet.html).toContain('<svg');
  });

  it('prints no date, because every other date on a fire asset means something', () => {
    // "Tested", "pressure tested", "replace by" — a print date read from six
    // feet up a ladder becomes one of those.
    const sheet = buildLabelSheet([label('SQ-EXT-0000042-SR')], { stock });
    expect(sheet.html).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
    expect(sheet.html).not.toMatch(/20\d\d-\d\d-\d\d/);
  });

  it('escapes a site name with an ampersand in it instead of breaking the page', () => {
    // "Smith & Sons" and "Level 3 <plant>" are ordinary site data.
    const sheet = buildLabelSheet(
      [{ ...label('SQ-EXT-0000042-SR'), siteName: 'Smith & Sons', location: 'Level 3 <plant>' }],
      { stock },
    );
    expect(sheet.html).toContain('Smith &amp; Sons');
    expect(sheet.html).toContain('&lt;plant&gt;');
    expect(sheet.html).not.toContain('<plant>');
  });

  it('applies a printer offset so a sheet that prints high can be nudged back', () => {
    const straight = buildLabelSheet([label('SQ-EXT-0000042-SR')], { stock });
    const nudged = buildLabelSheet([label('SQ-EXT-0000042-SR')], { stock, offsetXMm: 1, offsetYMm: -1.5 });
    expect(straight.html).toContain('left:7.25mm;top:15.15mm');
    expect(nudged.html).toContain('left:8.25mm;top:13.65mm');
  });

  it('refuses a printer nudge it cannot read instead of laying the sheet out at NaN', () => {
    // "1,5" on an Australian keyboard is a comma, and Number() makes NaN of it.
    // NaN travels silently through the arithmetic into "left:NaNmm", which no
    // browser honours: every label collapses to the corner of the page and a
    // whole sheet of adhesive stock goes in the bin.
    const sheet = buildLabelSheet([label('SQ-EXT-0000042-SR')], { stock, offsetXMm: Number('1,5') });
    expect(sheet.html).not.toContain('NaN');
    expect(sheet.html).toContain('left:7.25mm;top:15.15mm');
    expect(sheet.warnings.join(' ')).toContain('was not a number');
  });

  it('refuses a start position it cannot read, rather than silently skipping nothing', () => {
    const sheet = buildLabelSheet([label('SQ-EXT-0000042-SR')], { stock, startAt: Number('half way') });
    expect(sheet.sheets).toBe(1);
    expect(sheet.html).not.toContain('NaN');
    expect(sheet.warnings.join(' ')).toContain('Started at the first label instead');
  });

  it('says plainly when there is nothing it can print', () => {
    const sheet = buildLabelSheet([], { stock });
    expect(sheet.printed).toBe(0);
    expect(sheet.warnings.join(' ')).toContain('Nothing to print');
  });

  it('quotes a source and a confidence for every stock it offers', () => {
    // The dimensions come from retail listings, not from Avery's own site,
    // which refuses automated retrieval. Saying so is the difference between
    // sourced and assumed.
    for (const s of LABEL_STOCKS) {
      expect(s.source).toMatch(/^https?:|https?:\/\//);
      expect(['high', 'medium', 'low']).toContain(s.confidence);
      expect(s.columns * s.labelWidthMm + (s.columns - 1) * s.columnGapMm).toBeLessThanOrEqual(s.pageWidthMm);
      expect(s.rows * s.labelHeightMm + (s.rows - 1) * s.rowGapMm).toBeLessThanOrEqual(s.pageHeightMm);
    }
  });
});
