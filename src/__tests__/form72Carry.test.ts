/**
 * The figures a Form 72 made somebody type twice.
 *
 * The owner asked for the form to be easier to compile. Two of its boxes were
 * answered by something already on the form, and were typed again anyway —
 * which is not only slower, it is how a signed statutory document ends up
 * contradicting itself.
 *
 * Both are offered, never written. The screen puts each on a chip with its
 * working on it; nothing here fills a box on its own. A prefilled field reads
 * exactly like a checked field, and the only defence against that is making
 * the person tap.
 */
import {
  dutyToCarry, provedDuty, provedDutyDisagrees, emptyForm72, PART_D_ROWS, type FlowRow,
} from '@/domain/form72';

const FORM = () => emptyForm72({
  id: 'f1', siteId: 's1', siteName: 'Fictional Tower', now: '2026-10-06T00:00:00.000Z',
});

const rows = (...over: Partial<FlowRow>[]): FlowRow[] =>
  PART_D_ROWS.map((r) => ({ ...r, ...(over.find((o) => o.rateLps === r.rateLps && r.rateLps !== undefined)
    ?? over.find((o) => o.nozzleMm === r.nozzleMm && r.nozzleMm !== undefined) ?? {}) }));

describe('what Part D’s table proves, under Part D’s table', () => {
  it('reads the duty off the metered row that was run', () => {
    expect(provedDuty({ rows: rows({ rateLps: 10, hydrant1Kpa: 420, hydrants12Kpa: 350 }) }))
      .toEqual({ lps: 10, kpa: 350, from: 'the 10 L/s row at 1 & 2' });
  });

  it('takes the rightmost reading, because more hydrants is the harder case', () => {
    const proved = provedDuty({
      rows: rows({ rateLps: 10, hydrant1Kpa: 500, hydrants12Kpa: 430, hydrants123Kpa: 360 }),
    });
    expect(proved?.kpa).toBe(360);
  });

  it('prefers the higher duty where two rows were run', () => {
    const proved = provedDuty({
      rows: rows({ rateLps: 10, hydrant1Kpa: 420 }, { rateLps: 20, hydrant1Kpa: 300 }),
    });
    expect(proved?.lps).toBe(20);
  });

  it('prefers the row run on more hydrants where the duty is the same', () => {
    // Two rows cannot share a duty in the printed table, but a form carrying
    // rows written before the printed set existed can. The harder run is the
    // one worth stating.
    const proved = provedDuty({
      rows: [
        { rateLps: 10, devices: '', hydrant1Kpa: 420 },
        { rateLps: 10, devices: '', hydrant1Kpa: 400, hydrants12Kpa: 330 },
      ],
    });
    expect(proved).toEqual({ lps: 10, kpa: 330, from: 'the 10 L/s row at 1 & 2' });
  });

  it('says nothing where no metered row was run', () => {
    expect(provedDuty({ rows: PART_D_ROWS })).toBeUndefined();
  });

  it('says nothing for a nozzle run, rather than inventing a flow for it', () => {
    /*
     * A nozzle row holds a pitot pressure against a bore. Turning that into
     * litres per second needs a discharge coefficient that depends on the
     * nozzle in the technician's hand, which this app does not know — and a
     * flow invented from an assumed coefficient would reach a statutory form
     * looking exactly like a measurement.
     */
    expect(provedDuty({ rows: rows({ nozzleMm: 19, hydrant1Kpa: 300 }) })).toBeUndefined();
  });

  it('ignores a row somebody named a gauge on and never ran', () => {
    expect(provedDuty({ rows: [{ rateLps: 10, devices: 'MSP 12' }] })).toBeUndefined();
  });
});

describe('when the typed pair and the table disagree', () => {
  const run = rows({ rateLps: 10, hydrant1Kpa: 420, hydrants12Kpa: 350 });

  it('says nothing before anything is typed', () => {
    expect(provedDutyDisagrees({ rows: run })).toBeUndefined();
  });

  it('says nothing when they agree', () => {
    expect(provedDutyDisagrees({ rows: run, achievedLps: 10, achievedKpa: 350 })).toBeUndefined();
  });

  it('says so when the pressure was typed differently', () => {
    // The readings and the summary on one signed page, contradicting each
    // other, with nothing to catch it.
    expect(provedDutyDisagrees({ rows: run, achievedLps: 10, achievedKpa: 500 }))
      .toMatchObject({ lps: 10, kpa: 350 });
  });

  it('says so when only half the pair was typed', () => {
    expect(provedDutyDisagrees({ rows: run, achievedLps: 10 })).toMatchObject({ kpa: 350 });
  });

  it('is silent where there is no table to disagree with', () => {
    expect(provedDutyDisagrees({ rows: PART_D_ROWS, achievedLps: 10, achievedKpa: 350 }))
      .toBeUndefined();
  });
});

describe('the required duty, between Part D and Part E', () => {
  it('offers Part D’s pair to Part E', () => {
    const form = FORM();
    form.flowTest.requiredLps = 10;
    form.flowTest.requiredKpa = 700;
    expect(dutyToCarry(form)).toEqual({ lps: 10, kpa: 700 });
  });

  it('offers nothing until Part D has both halves', () => {
    const form = FORM();
    form.flowTest.requiredLps = 10;
    expect(dutyToCarry(form)).toBeUndefined();
  });

  it('offers nothing once Part E holds exactly it', () => {
    const form = FORM();
    form.flowTest.requiredLps = 10;
    form.flowTest.requiredKpa = 700;
    form.booster.requiredLps = 10;
    form.booster.requiredKpa = 700;
    expect(dutyToCarry(form)).toBeUndefined();
  });

  it('still offers it where Part E holds something else', () => {
    /*
     * Not a mistake to correct automatically. Part E's requirement is at the
     * booster and Part D's at the hydrant, and a system can be specified
     * differently at each — so the offer stands and the tap is the technician
     * saying they are the same here.
     */
    const form = FORM();
    form.flowTest.requiredLps = 10;
    form.flowTest.requiredKpa = 700;
    form.booster.requiredLps = 10;
    form.booster.requiredKpa = 900;
    expect(dutyToCarry(form)).toEqual({ lps: 10, kpa: 700 });
  });
});

describe('the screen offers them and writes neither', () => {
  const screen = require('node:fs')
    .readFileSync(require('node:path').join(__dirname, '..', '..', 'app', 'form72', '[id].tsx'), 'utf8');

  it('puts the table’s duty on a chip, with where it was read off', () => {
    expect(screen).toMatch(/Take \$\{proved\.lps\} L\/s at \$\{proved\.kpa\} kPa from \$\{proved\.from\}/);
  });

  it('puts Part D’s requirement on a chip in Part E', () => {
    expect(screen).toMatch(/Same as Part D — \$\{carry\.lps\} L\/s at \$\{carry\.kpa\} kPa/);
  });

  it('writes neither without the tap', () => {
    // Both must be inside an onPress. A useEffect that filled them would make
    // a prefilled figure indistinguishable from a measured one.
    for (const call of ['achievedLps: proved.lps', 'requiredLps: carry.lps']) {
      const at = screen.indexOf(call);
      expect({ call, found: at >= 0 }).toEqual({ call, found: true });
      expect(screen.slice(Math.max(0, at - 120), at)).toContain('onPress');
    }
  });

  it('shows a locked form neither chip, because a signed form is not edited', () => {
    expect(screen).toContain('{!locked && proved &&');
    expect(screen).toContain('{!locked && carry ?');
  });
});
