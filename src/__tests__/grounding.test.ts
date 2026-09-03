import {
  MAX_PASSAGES, PRIVACY_NOTE, SYSTEM_PROMPT, buildPrompt, checkAnswer, trimPassage, worthAsking,
  type Passage,
} from '@/ai/grounding';

/**
 * The harness that stops a language model inventing a fire safety answer.
 *
 * Everything here guards one failure: a confident sentence a technician acts on
 * that no document supports. The model is instructed not to, and instructions
 * are not a control — so the answer is checked on the way back, and anything
 * that cannot be traced to a supplied passage is thrown away rather than shown
 * with a caveat. A caveat under a wrong pressure figure does not stop anybody
 * using the figure.
 */

const p = (citation: string, text: string): Passage => ({ citation, text, source: 'test' });

const PASSAGES: Passage[] = [
  p('AS 2419.1:2005 clause 10.4', 'Systems that incorporate a booster shall be tested as follows.'),
  p('QDC MP 6.1 page 8', 'The occupier must give the commissioner a copy of the statement within 10 business days.'),
  p('AS 1670.1:2004 clause 5.1.4', 'Spacing from walls, partitions or air supply openings.'),
];

describe('the instruction given to the model', () => {
  it('forbids answering beyond the passages, in as many words', () => {
    expect(SYSTEM_PROMPT).toContain("I don't know from what is here");
    expect(SYSTEM_PROMPT).toContain('Never fall back on general knowledge');
  });

  it('forbids inventing or converting a figure', () => {
    // The specific failure: a model that helpfully converts kPa to psi, or
    // rounds an interval, has authored a number no document contains.
    expect(SYSTEM_PROMPT).toContain('Do not convert, round or interpolate');
  });
});

describe('buildPrompt', () => {
  it('numbers passages from one, because that is how the answer must cite them', () => {
    const prompt = buildPrompt({ question: 'when is the copy due', passages: PASSAGES });
    expect(prompt).toContain('[1] AS 2419.1:2005 clause 10.4');
    expect(prompt).toContain('[2] QDC MP 6.1 page 8');
    expect(prompt).not.toContain('[0]');
  });

  it('sends the question and the passages and nothing else', () => {
    // A technician asking about detector spacing has not agreed to send a
    // hospital's asset register to a third party.
    const prompt = buildPrompt({ question: 'detector spacing', passages: PASSAGES });
    expect(prompt).toContain('detector spacing');
    expect(prompt).not.toMatch(/site|customer|asset register|defect/i);
  });

  it('stops at the passage limit rather than burying the useful ones', () => {
    const many = Array.from({ length: 20 }, (_, i) => p(`ref ${i}`, `body ${i}`));
    const prompt = buildPrompt({ question: 'x', passages: many });
    expect(prompt).toContain(`[${MAX_PASSAGES}]`);
    expect(prompt).not.toContain(`[${MAX_PASSAGES + 1}]`);
  });

  it('says there are none rather than sending an empty list silently', () => {
    expect(buildPrompt({ question: 'x', passages: [] })).toContain('(none)');
  });
});

describe('trimPassage', () => {
  it('leaves a short passage alone', () => {
    expect(trimPassage('short enough')).toBe('short enough');
  });

  it('cuts at a sentence end where it can', () => {
    const text = `${'First sentence here. '.repeat(40)}tail`;
    const out = trimPassage(text, 200);
    expect(out.endsWith('.…') || out.endsWith('. ') || out.endsWith('.')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(202);
  });
});

describe('checkAnswer', () => {
  it('accepts an answer that cites what it was given', () => {
    const a = checkAnswer('Ten business days [2].', PASSAGES);
    expect(a.text).toBe('Ten business days [2].');
    expect(a.cited).toHaveLength(1);
    expect(a.cited[0]!.citation).toBe('QDC MP 6.1 page 8');
    expect(a.refusal).toBeUndefined();
  });

  it('discards an answer citing a passage that was never sent', () => {
    /*
     * The failure that matters. An answer citing [9] out of three passages has
     * stopped reading them and started composing, and the number it invented
     * will read exactly like the ones it did not.
     */
    const a = checkAnswer('The interval is five years [9].', PASSAGES);
    expect(a.text).toBeUndefined();
    expect(a.refusal).toContain('never sent to it');
    expect(a.cited).toEqual([]);
  });

  it('discards an answer that cites nothing at all', () => {
    // Uncheckable is the same as wrong here — there is no way to hold it
    // against the documents.
    const a = checkAnswer('You have ten business days to do that.', PASSAGES);
    expect(a.text).toBeUndefined();
    expect(a.refusal).toContain('cited nothing');
  });

  it('passes an honest refusal straight through', () => {
    const a = checkAnswer("I don't know from what is here. The block plan would say.", PASSAGES);
    expect(a.text).toBeUndefined();
    expect(a.refusal).toContain("I don't know from what is here");
    expect(a.refusal).toContain('honest answer rather than a guess');
  });

  it('returns each cited passage once, in the order cited', () => {
    const a = checkAnswer('See [3] and [1], and [3] again.', PASSAGES);
    expect(a.cited.map((c) => c.citation)).toEqual([
      'AS 1670.1:2004 clause 5.1.4',
      'AS 2419.1:2005 clause 10.4',
    ]);
  });

  it('handles an empty response rather than showing a blank answer', () => {
    expect(checkAnswer('   ', PASSAGES).refusal).toContain('returned nothing');
  });

  it('rejects a citation of zero, which is off the end of a one-based list', () => {
    expect(checkAnswer('As stated [0].', PASSAGES).text).toBeUndefined();
  });
});

describe('worthAsking', () => {
  it('refuses when the search found nothing to reason over', () => {
    // The search already said it did not know. The model does not get a second
    // go at the same question with no evidence.
    const w = worthAsking({ question: 'what is the capital of France', passages: [] });
    expect(w.ok).toBe(false);
    expect(w.reason).toContain('invited an invented answer'.replace('invited', 'invite'));
  });

  it('refuses a question too short to mean anything', () => {
    expect(worthAsking({ question: 'hi', passages: PASSAGES }).ok).toBe(false);
  });

  it('allows a real question with evidence behind it', () => {
    expect(worthAsking({ question: 'when is the copy due', passages: PASSAGES }).ok).toBe(true);
  });
});

describe('the privacy note', () => {
  it('states what leaves the device and what does not', () => {
    expect(PRIVACY_NOTE).toMatch(/not your asset register/);
    expect(PRIVACY_NOTE).toMatch(/not the customer/);
  });

  it('says plainly that it needs a network and the rest of the app does not', () => {
    expect(PRIVACY_NOTE).toContain('does not work in a plant room');
  });
});
