/**
 * A field the department never asked for cannot be an omission.
 *
 * Red on this page means exactly one thing: a box the department asks for,
 * left empty by the person who signed it. That is the whole value of the
 * colour — a reader can scan a form and see what was not answered.
 *
 * Safe QLD adds rows to the department's parts, each marked "added" so nobody
 * is shown one as the department's: a correction factor (Part C's own note
 * demands kPa or a percentage and the printed grid has nowhere to put one), a
 * Part D comment (Parts B, E, F and G carry one and Part D does not), the
 * residual at the hydrant (so a reader can check the frictional-loss
 * subtraction) and the system notes on Part H.
 *
 * Those rows were printing red when blank, and two things are wrong with that.
 * A blank in a row the department never asked for is not an omission against
 * anything. And the rows were added to the app after forms had already been
 * issued — so a form signed last year, correctly, with every department box
 * filled, grew four red "Not recorded" lines the day the app learned to ask
 * for something the department does not. Nothing about that document changed.
 *
 * They still answer rather than print blank: nothing on this page is ever
 * blank, because a gap nobody notices is what it exists to remove. Grey is an
 * answer. Red is an accusation.
 */
import { form72Html } from '@/export/form72';
import { emptyForm72, validateForm72, PART_D_ROWS, type Form72 } from '@/domain/form72';

/**
 * A form answered the way a technician on a hydrant job answers it: the parts
 * that apply are live and passed, and every added field is untouched because
 * none of them existed when this form was designed.
 */
const live = (): Form72 => {
  const form = emptyForm72({ id: 'f1', siteId: 's1', siteName: 'Fictional Tower', now: '2026-10-06T00:00:00.000Z' });
  form.testDate = '2026-10-06';
  form.contractor = 'A Contractor';
  form.licenseeName = 'A Licensee';
  form.licenceNumber = 'QBCC 1234567';
  form.devices = [{ slot: 'Device/gauge 1', serialNumber: 'FT-1188', dateCalibrated: '2026-03-02' }];
  form.flowTest = {
    result: 'pass', hydrantLocations: ['Front fence'], requiredLps: 10, requiredKpa: 700,
    rows: PART_D_ROWS.map((r) => (r.rateLps === 10 ? { ...r, devices: 'FT-1188', hydrant1Kpa: 620 } : r)),
    achievedLps: 10, achievedKpa: 620,
  };
  form.booster = { result: 'pass', requiredLps: 10, requiredKpa: 700, pumpDischargeKpa: 1100 };
  form.systemResult = 'pass';
  return form;
};

const render = (form: Form72) => form72Html({
  form, systemLabel: 'Towns Main System', companyName: 'A Contractor',
  generatedAt: '2026-10-06T00:00:00.000Z',
});

/** The cell that follows a label, which is what the label is answered by. */
function answerAfter(html: string, label: string): string {
  const at = html.indexOf(label);
  expect({ label, onThePage: at >= 0 }).toEqual({ label, onThePage: true });
  // From the end of that label's cell to the end of the row.
  const from = html.indexOf('</td>', at);
  const to = html.indexOf('</tr>', from);
  return html.slice(from, to);
}

const ADDED = [
  ['the correction factor', 'Correction factor (kPa or %)'],
  ['Part D’s comment', 'Comment <span class="extra">added</span>'],
  ['the residual at the hydrant', 'Residual at the hydrant'],
  ['Part H’s system notes', 'System notes:'],
] as const;

describe('an added field left blank on a live form', () => {
  const html = render(live());

  it.each(ADDED)('answers %s in grey rather than red', (_what, label) => {
    const answer = answerAfter(html, label);
    expect(answer).toContain('class="na"');
    expect(answer).not.toContain('class="missing"');
  });

  it.each(ADDED)('still answers %s rather than printing nothing', (_what, label) => {
    // The rule this page is built on. A blank cell is a gap nobody notices.
    expect(answerAfter(html, label)).toMatch(/Not recorded|N\/A/);
  });

  it('is marked as ours, so a reader never takes an added row for the department’s', () => {
    for (const [, label] of ADDED) {
      const at = html.indexOf(label);
      const row = html.slice(Math.max(0, at - 80), at + label.length + 80);
      expect({ label, marked: row.includes('class="extra"') }).toEqual({ label, marked: true });
    }
  });
});

describe('the department’s own boxes still go red', () => {
  it('because that is what the colour is for', () => {
    /*
     * The check that stops the fix going too far. "Date calibrated" is the
     * department's row on their own grid: a device with no calibration date is
     * a real omission and has to stay red, or the colour means nothing and
     * nobody reads it.
     */
    const form = live();
    form.devices = [{ slot: 'Device/gauge 1', serialNumber: 'FT-1188' }];
    const html = render(form);
    expect(answerAfter(html, 'Date calibrated')).toContain('class="missing"');
  });

  it('and an unanswered flow device still goes red', () => {
    expect(render(live())).toContain('<span class="missing">Not answered</span>');
  });
});

describe('inside a part marked not applicable', () => {
  it('an added field says N/A like everything else in it', () => {
    // A part the technician marked N/A answers N/A throughout, added rows
    // included — there is no third colour and no reason for one.
    const form = live();
    form.booster = { result: 'na' };
    const answer = answerAfter(render(form), 'Residual at the hydrant');
    expect(answer).toContain('N/A');
    expect(answer).not.toContain('class="missing"');
  });
});

describe('a figure that is there prints with its unit', () => {
  it('keeps the kPa on the residual, which is the point of showing it', () => {
    const form = live();
    form.booster = { ...form.booster, hydrantResidualKpa: 900 };
    const answer = answerAfter(render(form), 'Residual at the hydrant');
    expect(answer).toContain('900');
    expect(answer).toContain('kPa');
    expect(answer).not.toContain('class="na"');
  });
});

describe('Part A’s maintenance grid, with nothing ticked', () => {
  /*
   * Six tick boxes, and until now nothing when none of them was ticked.
   *
   * Every other field on this page answers: a blank reading prints "Not
   * recorded" in red, a part marked not applicable prints N/A in grey, and the
   * difference between the two is the point of the document. This grid alone
   * printed six empty boxes and said nothing — so "nobody has answered which
   * test this is" and "we looked and none applies" came out identical, on the
   * one field that says what the form is for.
   */
  const blank = () => {
    const form = live();
    form.maintenanceTest = {
      hydrantAnnual: false, hydrantFiveYear: false,
      sprinklerAnnual: false, sprinklerFiveYear: false,
      combinedAnnual: false, combinedFiveYear: false,
    };
    return form;
  };

  it('says so rather than printing six empty boxes and nothing else', () => {
    expect(render(blank())).toContain('Not answered — the form does not say what was done');
  });

  it('says it in red, because this is the department’s own box', () => {
    const html = render(blank());
    const at = html.indexOf('Not answered — the form does not say what was done');
    expect(html.slice(at - 40, at)).toContain('class="missing"');
  });

  it('says nothing once something is ticked', () => {
    const form = blank();
    form.maintenanceTest.hydrantAnnual = true;
    expect(render(form)).not.toContain('Not answered — the form does not say what was done');
  });

  it('can only ever appear on a draft, because issuing one is already blocked', () => {
    /*
     * The one thing that makes this safe to add to a renderer that also prints
     * forms signed years ago: validateForm72 blocks issuing a form with
     * nothing ticked, in those words, so no signed form can reach the branch.
     */
    const blocking = validateForm72(blank()).filter((i) => i.blocking);
    expect(blocking.map((i) => i.message))
      .toContain('No maintenance test ticked, so the form does not say what was done.');
  });
});
