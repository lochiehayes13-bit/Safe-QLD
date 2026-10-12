/**
 * A field the department never asked for cannot be an omission.
 *
 * Red on this page means exactly one thing: a box the department asks for,
 * left empty by the person who signed it. That is the whole value of the
 * colour. A reader can scan a form and see what was not answered.
 *
 * Safe QLD adds rows to the department's parts: a correction factor (Part C's
 * own note demands kPa or a percentage and the printed grid has nowhere to put
 * one), a Part D comment (Parts B, E, F and G carry one and Part D does not),
 * the residual at the hydrant (so a reader can check the frictional-loss
 * subtraction) and the system notes on Part H. None of them carries a marker;
 * each prints with a plain label, like the rows around it.
 *
 * Those rows were printing red when blank, and two things are wrong with that.
 * A blank in a row the department never asked for is not an omission against
 * anything. And the rows were added to the app after forms had already been
 * issued, so a form signed last year, correctly, with every department box
 * filled, grew four red "Not recorded" lines the day the app learned to ask
 * for something the department does not. Nothing about that document changed.
 *
 * Two rules follow. The correction factor row prints on every form that has a
 * device, because every pressure on the page is wrong by that factor until it
 * is applied; blank, it answers in grey. The comment, the residual and the
 * system notes print only when they hold something. A blank in a field the
 * department never asked for is nothing to report, so it takes up no row.
 * Grey is an answer. Red is an accusation. A row that is not there is neither.
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

const CORRECTION_FACTOR = 'Correction factor (kPa or %)';

/**
 * The added rows that print only when they hold something: what to call each
 * in a test name, the label that finds it on the page, how to fill it on a
 * form, and the text that filling it should print.
 *
 * Part D's label is matched as a whole cell. Parts B, E, F and G print the
 * department's "Comments:" and the word alone would land on the first of
 * those.
 */
const WHEN_FILLED: readonly [string, string, (form: Form72) => void, string][] = [
  ['Part D’s comment', '<td class="k">Comment</td>',
    (form) => { form.flowTest.comment = 'Hydrants 1 and 2 run together'; }, 'Hydrants 1 and 2 run together'],
  ['the residual at the hydrant', 'Residual at the hydrant',
    (form) => { form.booster.hydrantResidualKpa = 900; }, '900'],
  ['Part H’s system notes', 'System notes:',
    (form) => { form.systemNotes = 'Pump primed on the second attempt'; }, 'Pump primed on the second attempt'],
];

describe('the correction factor, the one added row that prints on every form', () => {
  const html = render(live());

  it('answers in grey rather than red when blank', () => {
    const answer = answerAfter(html, CORRECTION_FACTOR);
    expect(answer).toContain('class="na"');
    expect(answer).not.toContain('class="missing"');
  });

  it('still answers rather than printing nothing', () => {
    // Every pressure on the page is wrong by this factor until it is applied,
    // so the row is there whether or not anybody filled it, and a blank cell
    // in it is a gap nobody notices.
    expect(answerAfter(html, CORRECTION_FACTOR)).toContain('Not recorded');
  });
});

describe('an added row with nothing in it', () => {
  const html = render(live());

  it.each(WHEN_FILLED)('does not print %s at all', (_what, label) => {
    // A blank in a field the department never asked for is nothing to report.
    // Grey "Not recorded" against it still read as a line somebody missed.
    expect(html).not.toContain(label);
  });

  it.each(WHEN_FILLED)('prints %s once it holds something', (_what, label, fill, text) => {
    const form = live();
    fill(form);
    const answer = answerAfter(render(form), label);
    expect(answer).toContain(text);
    expect(answer).not.toContain('class="na"');
    expect(answer).not.toContain('class="missing"');
  });
});

describe('nothing on the page is marked "added"', () => {
  it('not a row, not a column head, not a group cell', () => {
    /*
     * The grey tags were build notes, not form content. A reader was told
     * which rows were Safe QLD's by a word beside the label; now the rows
     * print plain, and the attachment page is the one place that says what
     * is not the department's. A fifth device is the column the department
     * has no head for, which used to carry the tag too.
     */
    const form = live();
    form.devices = [
      ...form.devices,
      { slot: 'Device/gauge 2', serialNumber: 'G-2', dateCalibrated: '2026-03-02' },
      { slot: 'Device/gauge 3', serialNumber: 'G-3', dateCalibrated: '2026-03-02' },
      { slot: 'Device/gauge 4', serialNumber: 'G-4', dateCalibrated: '2026-03-02' },
      { slot: 'Device/gauge 5', serialNumber: 'G-5', dateCalibrated: '2026-03-02' },
    ];
    form.flowTest.comment = 'A comment';
    form.booster.hydrantResidualKpa = 900;
    form.systemNotes = 'A note';
    expect(render(form)).not.toContain('<span class="extra">added</span>');
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
  it('an added row with nothing in it is left out, as on a live part', () => {
    // There is no N/A to print against a row that is not there, and no third
    // colour either way.
    const form = live();
    form.booster = { result: 'na' };
    expect(render(form)).not.toContain('Residual at the hydrant');
  });

  it('a residual that was recorded still prints, with its unit', () => {
    // A reading somebody took on site is not dropped because the part was
    // later marked N/A. It prints as a figure, in no colour at all.
    const form = live();
    form.booster = { result: 'na', hydrantResidualKpa: 900 };
    const answer = answerAfter(render(form), 'Residual at the hydrant');
    expect(answer).toContain('900');
    expect(answer).toContain('kPa');
    expect(answer).not.toContain('class="na"');
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
   * printed six empty boxes and said nothing, so "nobody has answered which
   * test this is" and "we looked and none applies" came out identical, on the
   * one field that says what the form is for.
   */
  const NOT_ANSWERED = 'Not answered. The form does not say what was done';

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
    expect(render(blank())).toContain(NOT_ANSWERED);
  });

  it('says it in red, because this is the department’s own box', () => {
    const html = render(blank());
    const at = html.indexOf(NOT_ANSWERED);
    expect(html.slice(at - 40, at)).toContain('class="missing"');
  });

  it('says nothing once something is ticked', () => {
    const form = blank();
    form.maintenanceTest.hydrantAnnual = true;
    expect(render(form)).not.toContain(NOT_ANSWERED);
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
