import { decideAssetTest, explainRefusal, type AssetTestRefusal, type AssetTestToSend } from '@/domain/assetTestDecision';

/**
 * Deciding whether a test result goes back to the office.
 *
 * Every other outbound kind appends: a note, an order. The worst a bad one does
 * is leave something to delete. This one edits the field the office schedules
 * 12,546 live assets from, so the interesting cases are all the ones where it
 * must refuse — and refuse out loud, so a technician is never told the office
 * has a result it does not have.
 */

function test(over: Partial<AssetTestToSend> = {}): AssetTestToSend {
  return {
    externalAssetId: '1339',
    serviceLevelId: '3',
    result: 'pass',
    testedAt: '2026-09-01T09:15:00+10:00',
    description: 'Emergency light, upstairs far office',
    ...over,
  };
}

describe('the gate', () => {
  it('sends nothing while writing back is switched off', () => {
    // It ships off. Nobody's register gets edited because an app was installed.
    expect(decideAssetTest(test(), false)).toEqual({ send: false, reason: 'writing-disabled' });
  });

  it('sends when it is on and the result is expressible', () => {
    const d = decideAssetTest(test(), true);
    expect(d).toEqual({
      send: true,
      payload: {
        externalAssetId: '1339',
        serviceLevelId: '3',
        result: 'Pass',
        testedAt: '2026-09-01T09:15:00+10:00',
        description: 'Emergency light, upstairs far office',
      },
    });
  });
});

describe('what it refuses to send', () => {
  it.each([
    ['an asset that did not come from Simpro', { externalAssetId: undefined }, 'no-external-id'],
    ['an asset on no service frequency', { serviceLevelId: undefined }, 'no-service-level'],
    ['a not-tested result', { result: 'not-tested' }, 'result-not-expressible'],
    ['an N/A result', { result: 'na' }, 'result-not-expressible'],
    ['an empty result', { result: '' }, 'result-not-expressible'],
  ])('refuses %s', (_name, over, reason) => {
    expect(decideAssetTest(test(over as Partial<AssetTestToSend>), true))
      .toEqual({ send: false, reason });
  });

  it('will not turn an unreachable asset into a pass or a fail', () => {
    // The commonest real outcome on an annual is an asset nobody could get to.
    // Simpro has two values and neither is honest here: a fail raises a defect
    // that does not exist, a pass claims a test that never happened. It stays
    // in the note, in words, where the reason survives.
    for (const result of ['not-tested', 'na', 'inaccessible', 'no test']) {
      const d = decideAssetTest(test({ result }), true);
      expect({ result, send: d.send }).toEqual({ result, send: false });
    }
  });

  it('checks the gate before anything else', () => {
    // A refusal for a missing id when the feature is off would read as "fix the
    // asset and it will send", which is wrong and sends someone hunting.
    expect(decideAssetTest(test({ externalAssetId: undefined, result: 'na' }), false))
      .toEqual({ send: false, reason: 'writing-disabled' });
  });
});

describe('the result Simpro is given', () => {
  it.each([
    ['pass', 'Pass'],
    ['fail', 'Fail'],
    ['  PASS  ', 'Pass'],
    ['Fail', 'Fail'],
  ])('sends %s as %s', (given, expected) => {
    // Simpro's own casing. The app writes lower case internally and the two
    // must not be confused, or the office gets a value it does not recognise.
    const d = decideAssetTest(test({ result: given }), true);
    expect(d.send && d.payload.result).toBe(expected);
  });

  it('sends the date of the test, not the date of the send', () => {
    // A result queued on site and flushed three days later in signal is still a
    // test carried out on site. Dating it to the flush moves it into the next
    // service window.
    const d = decideAssetTest(test({ testedAt: '2026-08-28T14:00:00+10:00' }), true);
    expect(d.send && d.payload.testedAt).toBe('2026-08-28T14:00:00+10:00');
  });
});

describe('what a technician is told', () => {
  it.each([
    'writing-disabled',
    'no-external-id',
    'no-service-level',
    'result-not-expressible',
  ] as AssetTestRefusal[])('explains %s in words, without jargon', (reason) => {
    const text = explainRefusal(reason);
    expect(text.length).toBeGreaterThan(30);
    // No enum names leaking into something a person reads on a phone.
    expect(text).not.toMatch(/[a-z]+-[a-z]+-[a-z]+/);
  });

  it('says where the result did go, so nobody thinks it was lost', () => {
    for (const reason of ['writing-disabled', 'result-not-expressible'] as AssetTestRefusal[]) {
      expect(explainRefusal(reason)).toMatch(/job note|saved here/i);
    }
  });
});
