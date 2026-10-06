import {
  intervalsTested, systemTypesTested, type Form72,
} from '@/domain/form72';

/**
 * Which parts of Form 72 this test needs, in the order they are worth filling
 * in, and what is still outstanding.
 *
 * The owner's ask was a form that is a click-through rather than ten chips and
 * a guess about which of them matter. The commonest form this company raises
 * is an annual hydrant test, on which Parts F and G do not apply at all — and
 * the screen presented all ten identically, so a technician either walked
 * through two parts of empty sprinkler boxes or learned to skip parts, which
 * is the habit that leaves Part B unanswered on a form that needed it.
 *
 * **This is read by the screen and by nothing else.** It must never be folded
 * into validateForm72. form72Html runs that validation on issued forms as well
 * as drafts (see src/export/form72.ts), so a new blocking rule added there
 * would stamp DRAFT — NOT FOR ISSUE across forms that were signed and given to
 * an occupier months ago. Guidance about what to fill in next belongs where
 * somebody is filling it in.
 *
 * **It decides what is asked, never what is answered.** Nothing here writes a
 * result. A part this says does not apply still prints whatever the technician
 * left on it, and a technician who disagrees can open it and answer it: every
 * state below is advice with its reason attached, and no part is ever closed
 * off. The department's form is the authority on what the form says; this is
 * only the order to walk it in.
 */

/** The parts, as the screen keys them. */
export type GuidePart = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'Attachment';

/**
 * Records that a part has been answered, for a form that is being edited.
 *
 * Returns the patch to store, or nothing where the part is already recorded —
 * so a technician tapping a result picker twice does not write twice. It is
 * additive and never removes a part: an answer changed from pass to N/A is
 * still an answer, and a technician who clears a reading has still looked at
 * the part.
 */
export function recordAnswered(
  form: Form72, part: GuidePart,
): { answeredParts: string[] } | undefined {
  const held = form.answeredParts ?? [];
  if (held.includes(part)) return undefined;
  return { answeredParts: [...held, part] };
}

/**
 * How much this part has to do with the test in front of the technician.
 *
 * Five states, because "does not apply" arrives from three different places
 * and a technician needs to see which one is talking: a part the department
 * requires of every form, a part this system puts in or leaves out, a part the
 * form's own wording leaves to the technician, and a part that is not the
 * department's form at all.
 */
export type Applicability =
  /** The department asks it of every Form 72. */
  | 'always'
  /** Part A's system axis puts it in. */
  | 'this-system'
  /**
   * Part A's system axis leaves it out. The only state derived from the
   * technician's own answer rather than guessed, which is why it is the only
   * one the screen is willing to fold away.
   */
  | 'not-this-system'
  /**
   * The form's wording leaves it to the technician — "(as applicable)", or a
   * site fact the form does not record, such as whether there is a booster.
   * Never pre-answered: an unasked question that defaults to N/A is the one
   * failure mode this whole module exists to avoid.
   */
  | 'ask'
  /** Not on the department's form. */
  | 'optional';

export interface GuideStep {
  part: GuidePart;
  applies: Applicability;
  /** One line, in the technician's words, saying why it is in that state. */
  why: string;
  /** Whether anything has been put on it. */
  answered: boolean;
}

/**
 * The order to walk the form in, which is not the order the department prints
 * it in.
 *
 * Two swaps, both for the same reason — you cannot answer the later one first.
 * Part C, the equipment, comes before the readings taken with it: a technician
 * who reaches Part D and has to name a device in the "Device/gauge no. (Part
 * C)" column needs Part C already filled in, and the form's own column heading
 * says so. Part I, the signature, comes last of all, after the attachment,
 * because signing is the last thing anybody should do.
 */
export const GUIDE_ORDER: readonly GuidePart[] = [
  'A', 'C', 'B', 'D', 'E', 'F', 'G', 'H', 'Attachment', 'I',
];

/**
 * Whether somebody has answered this part.
 *
 * Two routes, and the first is the real one: a part recorded in answeredParts
 * was answered, N/A included. That is the only way "the technician marked Part
 * B not applicable" can be told from "nobody opened Part B", because every
 * part result starts as 'na' and the two look identical in storage and on the
 * printed page alike.
 *
 * The second route reads the part's own contents, and exists for forms written
 * before v37 added the column. It cannot tell a deliberate N/A from an
 * untouched part — nothing could, for those forms — so it reports an untouched
 * part and a part marked N/A both as unanswered. That is the behaviour the app
 * had before, and naming a part the technician has already dealt with is a
 * smaller fault than missing one they have not.
 */
export function partAnswered(form: Form72, part: GuidePart): boolean {
  if (form.answeredParts?.includes(part)) return true;
  switch (part) {
    case 'A': return !!form.testDate && !!form.contractor.trim();
    case 'B': return form.hydrostatic.result !== 'na';
    case 'C': return form.devices.length > 0;
    case 'D': return form.flowTest.result !== 'na';
    case 'E': return form.booster.result !== 'na';
    case 'F': return form.sprinklerHydrostatic.result !== 'na';
    case 'G': return form.sprinklerFlow.result !== 'na';
    case 'H': return form.systemResult !== 'na' || form.criticalDefectsIdentified !== undefined;
    case 'I': return !!form.licenceNumber.trim() && !!form.signature;
    // Not part of the department's form, so nothing on it can be outstanding.
    // It reads as answered once anything has been put on it.
    case 'Attachment':
      return !!form.owner?.trim() || !!form.technician?.trim() || form.defects.length > 0;
    default: return false;
  }
}

/**
 * What the system axis of Part A says, as the two questions that decide the
 * rest of the form.
 *
 * Read from the axis rather than from a single "system type", because the form
 * lets a technician tick fire hydrant, fire sprinkler and combined
 * independently, and a combined system is both.
 */
function systems(form: Form72): { hydrant: boolean; sprinkler: boolean; stated: boolean } {
  const types = systemTypesTested(form.maintenanceTest);
  const combined = types.includes('combined');
  return {
    hydrant: combined || types.includes('hydrant'),
    sprinkler: combined || types.includes('sprinkler'),
    stated: types.length > 0,
  };
}

/**
 * Which parts this test needs, and why.
 *
 * Every reason is grounded in the part's own subject or the standards its note
 * cites, not in a habit. Where the form itself declines to decide — Part B's
 * "(as applicable)", Part E's booster that may not exist — this declines too,
 * and says so, rather than filling in an answer nobody gave.
 */
export function guideSteps(form: Form72): GuideStep[] {
  const sys = systems(form);
  const fiveYear = intervalsTested(form.maintenanceTest).includes('fiveYear');

  const step = (part: GuidePart, applies: Applicability, why: string): GuideStep =>
    ({ part, applies, why, answered: partAnswered(form, part) });

  /*
   * Until Part A says what was tested, nothing downstream can be ruled in or
   * out — so everything is asked. Guessing from an empty Part A would be the
   * app answering the question Part A exists to ask.
   */
  const unstated = 'Part A does not say yet which system was tested, so nothing is ruled out.';

  return [
    step('A', 'always', 'What this document is a record of. Nothing else can be decided until it '
      + 'says which system and which test.'),

    step('C', sys.stated && !sys.hydrant ? 'optional' : 'this-system',
      !sys.stated ? unstated
        : sys.hydrant
          ? 'The equipment the readings in Parts D and E were taken with. Part D names a device '
            + 'per row from this list, so it is worth filling in first.'
          : 'Headed "Hydrant test equipment", and this is a sprinkler test. Fill it in if a gauge '
            + 'you used needs recording.'),

    step('B', !sys.stated ? 'ask' : sys.hydrant ? 'ask' : 'not-this-system',
      !sys.stated ? unstated
        : sys.hydrant
          ? 'A hydrant pipework pressure test. The form says "(as applicable)" — whether this '
            + 'annual needed one is yours to answer, not the app\'s.'
          : 'Hydrant pipework, and Part A says this was a sprinkler test.'),

    step('D', !sys.stated ? 'ask' : sys.hydrant ? 'this-system' : 'not-this-system',
      !sys.stated ? unstated
        : sys.hydrant
          ? 'The hydrant flow table — the part that proves the duty. Section 4 of AS1851.'
          : 'A hydrant flow test, and Part A says this was a sprinkler test.'),

    step('E', 'ask',
      'Sections 10.4 and 10.5 of AS2419.1, and only where there is a pump appliance booster to '
      + 'test. The form does not record whether this site has one.'),

    step('F', !sys.stated ? 'ask' : sys.sprinkler ? 'this-system' : 'not-this-system',
      !sys.stated ? unstated
        : sys.sprinkler
          ? 'A sprinkler pipework pressure test, to AS2118.1, AS2118.4 and AS2118.6.'
          : 'Sprinkler pipework, and Part A says this was a hydrant test.'),

    step('G', !sys.stated ? 'ask' : sys.sprinkler ? 'this-system' : 'not-this-system',
      !sys.stated ? unstated
        : sys.sprinkler
          ? 'The sprinkler test points. The form\'s own note says multiple points may be needed, '
            + 'and each one\'s location and descriptor recorded.'
          : 'A sprinkler flow test, and Part A says this was a hydrant test.'),

    step('H', 'always', 'Whether critical defects were found, what was repaired, and the system '
      + 'result. The department asks it of every form.'),

    step('Attachment', 'optional',
      'Owner, technician, building class and the defect list. Not the department\'s form — it '
      + 'prints on its own page after Part I'
      + (fiveYear ? ', and a five-yearly is usually more than one person over more than one day.'
        : '.')),

    step('I', 'always', 'The licensee\'s declaration and signature. Last, because signing is the '
      + 'last thing to do.'),
  ];
}

/**
 * The next part worth opening after this one, and nothing if there is none.
 *
 * Walks GUIDE_ORDER forward and takes the first part that is both unanswered
 * and worth asking about. A part Part A has ruled out is skipped — that is the
 * one state derived from the technician's own answer — but a part in the 'ask'
 * state is not, because an unasked question is exactly what this exists to
 * prevent.
 */
export function nextGuideStep(form: Form72, after?: GuidePart): GuideStep | undefined {
  const steps = guideSteps(form);
  const from = after === undefined ? 0 : GUIDE_ORDER.indexOf(after) + 1;
  for (const part of GUIDE_ORDER.slice(Math.max(from, 0))) {
    const step = steps.find((s) => s.part === part);
    if (!step || step.answered) continue;
    if (step.applies === 'not-this-system' || step.applies === 'optional') continue;
    return step;
  }
  return undefined;
}

/**
 * What is still outstanding on this form, in walking order.
 *
 * A part that applies and has nothing on it. This is the thing a technician
 * cannot see today: every part that was never opened prints N/A exactly like a
 * part they marked N/A on purpose, so a form missing an answer looks finished.
 */
export function outstandingParts(form: Form72): GuideStep[] {
  const steps = guideSteps(form);
  return GUIDE_ORDER
    .map((part) => steps.find((s) => s.part === part))
    .filter((s): s is GuideStep => !!s
      && !s.answered && s.applies !== 'not-this-system' && s.applies !== 'optional');
}
