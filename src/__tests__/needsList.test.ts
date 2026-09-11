import {
  STATE_LABEL, groupNeeds, markOrdered, moveNeed, needHeadline, needSortKey, needSubtitle,
  needsCsvRows, openNeedCount, orderableLines, otherWhen, parseNeedLine, sortNeeds, tickNeed,
  withNeedState, type NeedLine,
} from '@/domain/needsList';

/**
 * The list of things a technician needs to get.
 *
 * Two of these tests are about a fear rather than a feature. The first is that
 * the line is hard to write: this list only works if "flow meter" typed with
 * one hand is a complete record, and every convenience in the parser has to be
 * checked for the case where it reads too much into what somebody typed —
 * "4.5 kg ABE" is one extinguisher, and reading it as four and a half of
 * something puts a wrong number on a line nobody looks at twice.
 *
 * The second is that the list is hard to tick. Nothing here deletes anything,
 * and un-ticking has to put a line back exactly as it was, including the fact
 * that the office is already getting it. A list somebody is afraid to tick
 * stops being ticked, and then stops being read.
 */

const AT = '2026-09-03T01:15:00.000Z';

function line(over: Partial<NeedLine> = {}): NeedLine {
  return {
    id: 'n1',
    what: 'Flow meter',
    when: 'now',
    state: 'needed',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

describe('reading a line the way it gets typed', () => {
  it('takes a bare few words as the whole thing, because that is what one hand types', () => {
    expect(parseNeedLine('flow meter')).toEqual({
      what: 'flow meter', whatWithWhere: 'flow meter', quantity: undefined, siteHint: undefined,
    });
  });

  it('pulls the count and the building out of a line somebody wrote in full', () => {
    expect(parseNeedLine('2 x 4.5kg ABE for YMCA Bowen Hills')).toEqual({
      what: '4.5kg ABE',
      whatWithWhere: '4.5kg ABE for YMCA Bowen Hills',
      quantity: 2,
      siteHint: 'YMCA Bowen Hills',
    });
  });

  it('reads a count written either way round, with or without the x', () => {
    expect(parseNeedLine('3 flow meters').quantity).toBe(3);
    expect(parseNeedLine('2x hose reel nozzles').quantity).toBe(2);
    expect(parseNeedLine('hose reel nozzle x2')).toMatchObject({ what: 'hose reel nozzle', quantity: 2 });
  });

  it('does not read a size as a count, which is the one that would be wrong quietly', () => {
    // One 4.5kg extinguisher, not four and a half of anything.
    expect(parseNeedLine('4.5 kg ABE')).toMatchObject({ what: '4.5 kg ABE', quantity: undefined });
    expect(parseNeedLine('4.5kg ABE')).toMatchObject({ what: '4.5kg ABE', quantity: undefined });
    expect(parseNeedLine('12v battery')).toMatchObject({ what: '12v battery', quantity: undefined });
    expect(parseNeedLine('0 x nothing').quantity).toBeUndefined();
  });

  it('keeps the "for …" on the words as well as pulling it off', () => {
    /*
     * The screen only takes the clause off when the hint turns out to name a
     * site the phone holds. "Extinguisher for the pump room" matches no
     * building, and dropping those three words would throw away the only thing
     * on the line that says where the part goes.
     */
    const parsed = parseNeedLine('extinguisher for the pump room');
    expect(parsed.what).toBe('extinguisher');
    expect(parsed.siteHint).toBe('the pump room');
    expect(parsed.whatWithWhere).toBe('extinguisher for the pump room');
  });

  it('takes the last "for", so a description with one in it survives', () => {
    expect(parseNeedLine('battery for panel for Baldwin Living')).toMatchObject({
      what: 'battery for panel', siteHint: 'Baldwin Living',
    });
  });

  it('tidies the spacing and says nothing at all about an empty box', () => {
    expect(parseNeedLine('  two   spare   nozzles ').what).toBe('two spare nozzles');
    expect(parseNeedLine('   ')).toEqual({ what: '', whatWithWhere: '' });
  });
});

describe('the order the list reads in', () => {
  it('puts the same part together however many sites want it', () => {
    // One trip to the supplier rather than two: the two sites wanting the same
    // head read as one block, whatever case each was typed in.
    const lines = [
      line({ id: 'a', what: 'Detector head', partNumber: 'SD-100', siteName: 'Zillmere' }),
      line({ id: 'b', what: 'Flow meter' }),
      line({ id: 'c', what: 'detector head', partNumber: 'SD-100', siteName: 'Acacia Ridge' }),
    ];
    expect(sortNeeds(lines).map((l) => l.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts by the words where nobody has attached a part number yet', () => {
    expect(needSortKey(line({ what: 'Flow Meter' }))).toBe('flow meter');
    expect(needSortKey(line({ what: 'Flow Meter', partNumber: ' SD-100 ' }))).toBe('sd-100');
  });

  it('splits now from later, and always returns both halves', () => {
    const groups = groupNeeds([line({ id: 'a' }), line({ id: 'b', when: 'future' })]);
    expect(groups.map((g) => g.when)).toEqual(['now', 'future']);
    expect(groups[0]!.open.map((l) => l.id)).toEqual(['a']);
    expect(groups[1]!.open.map((l) => l.id)).toEqual(['b']);
    // An empty half still comes back, so the screen can show that the list has
    // two of them before anything is in the second one.
    expect(groupNeeds([]).map((g) => g.open.length)).toEqual([0, 0]);
  });

  it('moves what has been got underneath, newest first, rather than out of the list', () => {
    const groups = groupNeeds([
      line({ id: 'a', state: 'got', gotAt: '2026-09-01T02:00:00.000Z' }),
      line({ id: 'b' }),
      line({ id: 'c', state: 'got', gotAt: '2026-09-02T02:00:00.000Z' }),
      line({ id: 'd', state: 'ordered', what: 'Zulu part' }),
    ]);
    // On order is still something you have not got, so it stays in the open list.
    expect(groups[0]!.open.map((l) => l.id)).toEqual(['b', 'd']);
    expect(groups[0]!.got.map((l) => l.id)).toEqual(['c', 'a']);
  });

  it('counts only what is still to get', () => {
    expect(openNeedCount([line({ id: 'a' }), line({ id: 'b', state: 'ordered' }), line({ id: 'c', state: 'got' })]))
      .toBe(2);
  });
});

describe('ticking a line', () => {
  it('marks it got and stamps when, without touching anything else', () => {
    const got = tickNeed(line({ note: 'Ask for the brass one' }), AT);
    expect(got).toMatchObject({ state: 'got', gotAt: AT, updatedAt: AT, note: 'Ask for the brass one' });
  });

  it('un-ticks back to on order when the office was already getting it', () => {
    // The tap that undoes a mistake must not also undo the request.
    const ordered = markOrdered(line(), '2026-09-02T00:00:00.000Z', 'PO 4471', 'pr-1');
    const back = tickNeed(tickNeed(ordered, AT), AT);
    expect(back).toMatchObject({
      state: 'ordered', gotAt: undefined, orderedAt: '2026-09-02T00:00:00.000Z',
      orderNote: 'PO 4471', purchaseRequestId: 'pr-1',
    });
  });

  it('un-ticks back to needed where it had never been ordered', () => {
    expect(tickNeed(tickNeed(line(), AT), AT)).toMatchObject({ state: 'needed', gotAt: undefined });
  });

  it('keeps the first time it was ordered when it is marked ordered twice', () => {
    const first = markOrdered(line(), '2026-09-02T00:00:00.000Z');
    expect(markOrdered(first, AT).orderedAt).toBe('2026-09-02T00:00:00.000Z');
  });

  it('remembers the request when a line goes back to needed, because the request really happened', () => {
    const ordered = markOrdered(line(), '2026-09-02T00:00:00.000Z', 'PO 4471', 'pr-1');
    const back = withNeedState(ordered, 'needed', AT);
    expect(back).toMatchObject({
      state: 'needed', orderedAt: undefined, gotAt: undefined, orderNote: 'PO 4471', purchaseRequestId: 'pr-1',
    });
  });

  it('moves a line between now and later, and leaves it alone when it is already there', () => {
    expect(moveNeed(line(), 'future', AT)).toMatchObject({ when: 'future', updatedAt: AT });
    expect(moveNeed(line(), 'now', AT).updatedAt).toBe('2026-09-01T00:00:00.000Z');
    expect(otherWhen('now')).toBe('future');
    expect(otherWhen('future')).toBe('now');
  });
});

describe('handing the list on', () => {
  it('puts only what is still needed on a purchase request', () => {
    // Something already on order would be ordered twice; something already in
    // the van does not need ordering at all.
    const lines = [
      line({ id: 'a', what: 'Flow meter' }),
      line({ id: 'b', what: 'Detector head', state: 'ordered' }),
      line({ id: 'c', what: 'Nozzle', state: 'got' }),
    ];
    expect(orderableLines(lines)).toEqual([
      { partNumber: '', description: 'Flow meter', quantity: 1 },
    ]);
  });

  it('says one where nobody wrote a number, and names the site in the wording', () => {
    const lines = [line({ what: '4.5kg ABE', quantity: 2, partNumber: 'ABE45', siteName: 'YMCA Bowen Hills' })];
    expect(orderableLines(lines)).toEqual([
      { partNumber: 'ABE45', description: '4.5kg ABE (for YMCA Bowen Hills)', quantity: 2 },
    ]);
  });

  it('exports the ticked lines too, so the office is not sent a list of failures', () => {
    const rows = needsCsvRows([
      line({ id: 'a', what: 'Flow meter', quantity: 2, siteName: 'Zillmere' }),
      line({ id: 'b', what: 'Nozzle', when: 'future', state: 'got', gotAt: '2026-09-02T22:00:00.000Z' }),
    ]);
    expect(rows[0]).toEqual([
      'When', 'What', 'Quantity', 'Part number', 'Site', 'State', 'Note', 'Added', 'Ordered', 'Got',
    ]);
    expect(rows[1]).toEqual(['For now', 'Flow meter', 2, '', 'Zillmere', 'Needed', '', '01/09/2026', '', '']);
    // The Queensland day, not the UTC one: 22:00 UTC is already the third here.
    expect(rows[2]).toEqual(['Future works', 'Nozzle', '', '', '', 'Got it', '', '01/09/2026', '', '03/09/2026']);
  });

  it('reads a line back as one sentence, with the count in front and the rest under it', () => {
    expect(needHeadline(line({ what: '4.5kg ABE', quantity: 2 }))).toBe('2 × 4.5kg ABE');
    expect(needHeadline(line({ what: 'Flow meter' }))).toBe('Flow meter');
    expect(needSubtitle(line({ partNumber: 'ABE45', siteName: 'Zillmere', note: 'brass' })))
      .toBe('ABE45 · Zillmere · brass');
    expect(needSubtitle(line())).toBe('');
  });

  it('has a word for every state, since a pill with no label is a coloured dot', () => {
    expect(Object.values(STATE_LABEL)).toEqual(['Needed', 'On order', 'Got it']);
  });
});
