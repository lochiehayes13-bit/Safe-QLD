import { SWMS_TEMPLATES } from '@/seed/swms';
import { CONTROL_LEVEL_ORDER, RISK_ORDER, type SwmsTemplate } from '@/domain/swms';

/**
 * The statements the company actually ships, checked as content rather than as code.
 *
 * A method statement is not a document that fails loudly. A control at the
 * wrong level of the hierarchy, a residual risk lower than the controls could
 * possibly justify, a citation to a regulation that was repealed last month —
 * each of those produces a document that reads correctly to everyone who signs
 * it, and is wrong at the moment somebody relies on it.
 *
 * These were drafted, then adversarially reviewed by readers whose job was to
 * refuse to sign them, then corrected against the reviews. A second read then
 * checked whether the corrections landed, and on the five statements it reached
 * the answer was no — see data/swms-review/. So none of them is cleared for
 * signature, and mergeSwms says so on every path to a signature.
 *
 * What that process caught, no test could have. What no review can do is stay
 * caught: the next edit to this content will be made by a person in a hurry. So
 * the mechanical half of it is written down here.
 */

const templates = SWMS_TEMPLATES as readonly SwmsTemplate[];

/**
 * Instruments that no longer exist.
 *
 * The Electrical Safety Regulation 2013 (Qld) was repealed by the Electrical
 * Safety Regulation 2026 (Qld), SL 2026 No. 113, which commenced 1 September
 * 2026 — verified against legislation.qld.gov.au while this content was being
 * written. A control pointing at a dead instrument states an obligation nobody
 * is under and omits the one they are.
 *
 * Naming it is not the same as relying on it. A reference that says "the 2026
 * regulation, which replaced the repealed 2013 one" is doing a reader with an
 * old copy on the ute dashboard a favour, and a check that cannot tell those
 * apart is a check that gets switched off. So what is forbidden is the name
 * without the repeal beside it.
 */
const REPEALED: { name: RegExp; replacedBy: RegExp }[] = [
  { name: /Electrical Safety Regulation 2013/i, replacedBy: /Electrical Safety Regulation 2026/i },
  { name: /Workplace Health and Safety Act 1995/i, replacedBy: /Work Health and Safety Act 2011/i },
];

const SAYS_REPEALED = /repeal|supersed|replac|no longer|out of date|must not be cited|not in force/i;

/** Every string anywhere in the statement, so nothing hides in a nested control. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) strings(v, out);
  return out;
}

describe('the shipped statements', () => {
  it('ships the statements it means to', () => {
    /*
     * Pinned rather than a floor. A seed that quietly became [] passes every
     * check below it, and so does one that lost a statement in an edit — and
     * a method statement that silently stops being offered is the one nobody
     * notices until a principal contractor asks for it.
     *
     * All ten, each through drafting, an adversarial review by a reader whose
     * job was to refuse to sign it, and a correction pass that checked every
     * legal citation against legislation.qld.gov.au.
     */
    expect(templates.map((t) => t.id).sort()).toEqual([
      'asbestos-silica',
      'confined-space',
      'electrical',
      'extinguisher-cylinders',
      'heights',
      'hot-work',
      'hydrant-flow',
      'live-testing',
      'sprinkler-wet',
      'traffic-lone',
    ]);
  });

  it('gives each one an id nothing else uses', () => {
    const ids = templates.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('describes the work, when to use it, and what to do when it goes wrong', () => {
    for (const t of templates) {
      expect(t.title.length).toBeGreaterThan(10);
      expect(t.activity.length).toBeGreaterThan(60);
      expect(t.whenRequired.length).toBeGreaterThan(60);
      // The emergency section is the part nobody reads until the day they
      // have to, and the day they have to is not the day to be vague.
      expect(t.emergency.length).toBeGreaterThan(120);
      expect(t.steps.length).toBeGreaterThanOrEqual(5);
      expect(t.ppe.length).toBeGreaterThanOrEqual(4);
      expect(t.references.length).toBeGreaterThanOrEqual(4);
      // The questions only the site can answer are the whole difference
      // between a signed statement and a generic one.
      expect(t.siteSpecificPrompts.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('quotes the high-risk category rather than implying it', () => {
    for (const t of templates) {
      for (const h of t.hrcw) {
        expect(h.clause).toMatch(/Regulation 2011 \(Qld\)/);
        expect(h.clause).toMatch(/s ?\d{3}/);
        expect(h.text.length).toBeGreaterThan(20);
      }
    }
  });

  it('reads its controls in hierarchy order, highest first', () => {
    /*
     * Not cosmetic. A crew reads down the list and does the first thing they
     * can do; a PPE line above an isolation line is a crew putting gloves on
     * instead of locking something off.
     */
    const wrong: string[] = [];
    for (const t of templates) {
      t.steps.forEach((s, i) => {
        const levels = s.controls.map((c) => CONTROL_LEVEL_ORDER[c.level]);
        if (levels.some((n, j) => j > 0 && n < levels[j - 1]!)) {
          wrong.push(`${t.id} step ${i + 1}: ${s.controls.map((c) => c.level).join(' → ')}`);
        }
      });
    }
    expect(wrong).toEqual([]);
  });

  it('never leaves a step riskier than it started', () => {
    const wrong: string[] = [];
    for (const t of templates) {
      t.steps.forEach((s, i) => {
        if (RISK_ORDER[s.residualRisk] > RISK_ORDER[s.initialRisk]) {
          wrong.push(`${t.id} step ${i + 1}: ${s.initialRisk} → ${s.residualRisk}`);
        }
      });
    }
    expect(wrong).toEqual([]);
  });

  it('does not claim a low residual off paperwork and gloves alone', () => {
    /*
     * The most common way a method statement lies. A step whose only controls
     * are a procedure and personal protective equipment has not removed the
     * hazard — it has asked a person not to be hurt by it — and calling that
     * low is how an extreme hazard gets signed off.
     */
    const wrong: string[] = [];
    for (const t of templates) {
      t.steps.forEach((s, i) => {
        const levels = new Set(s.controls.map((c) => c.level));
        const soft = [...levels].every((l) => l === 'administrative' || l === 'ppe');
        if (s.residualRisk === 'low' && soft) wrong.push(`${t.id} step ${i + 1}`);
      });
    }
    expect(wrong).toEqual([]);
  });

  it('gives every step somebody responsible and something to be afraid of', () => {
    for (const t of templates) {
      for (const s of t.steps) {
        expect(s.step.length).toBeGreaterThan(8);
        expect(s.hazards.length).toBeGreaterThanOrEqual(1);
        expect(s.controls.length).toBeGreaterThanOrEqual(1);
        expect(s.responsible.length).toBeGreaterThan(3);
      }
    }
  });

  it('relies on no instrument that has been repealed', () => {
    const dead: string[] = [];
    for (const t of templates) {
      for (const s of strings(t)) {
        for (const { name } of REPEALED) {
          // Named without its repeal beside it is a citation, not a footnote.
          if (name.test(s) && !SAYS_REPEALED.test(s)) dead.push(`${t.id}: "${s.slice(0, 120)}"`);
        }
      }
    }
    expect(dead).toEqual([]);
  });

  it('cites the instrument that replaced it, wherever the old one is mentioned', () => {
    /*
     * The other half. Saying "the 2013 regulation is repealed" and then not
     * saying what governs instead leaves a crew with a control and no law
     * behind it.
     */
    const orphaned: string[] = [];
    for (const t of templates) {
      const all = strings(t).join('\n');
      for (const { name, replacedBy } of REPEALED) {
        if (name.test(all) && !replacedBy.test(all)) orphaned.push(`${t.id}: ${name.source}`);
      }
    }
    expect(orphaned).toEqual([]);
  });

  it('has at least one statement covering high-risk construction work', () => {
    // If none of them does, either the content is wrong or the categories were
    // dropped in an edit — and the second is silent.
    expect(templates.filter((t) => t.hrcw.length > 0).length).toBeGreaterThanOrEqual(5);
  });
});
