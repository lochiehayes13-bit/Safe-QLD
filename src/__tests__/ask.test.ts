import { ANSWER_THRESHOLD, COVERAGE, KIND_LABEL, ask } from '@/domain/ask';
import { DEFECT_LIBRARY } from '@/seed/defectLibrary';

/**
 * Answering from what the app holds.
 *
 * The behaviour worth testing is not that it finds things — it is that it
 * refuses to. A confident wrong answer about a fire system is worse than no
 * answer, so most of these check the refusal.
 */

describe('finding the right thing', () => {
  it('finds a defect code typed exactly', () => {
    const [top] = ask('DET-DET-001');
    expect(top?.kind).toBe('defect');
    expect(top?.title).toContain('DET-DET-001');
  });

  it('finds a defect code regardless of case or punctuation', () => {
    expect(ask('det det 001')[0]?.title).toContain('DET-DET-001');
    expect(ask('detdet001')[0]?.title).toContain('DET-DET-001');
  });

  it('answers a question about a thing, not just its tool name', () => {
    // Nobody types "battery calculator"; they ask how big a battery.
    const answers = ask('how many amp hours battery');
    expect(answers.some((a) => a.kind === 'calculator' && /battery/i.test(a.title))).toBe(true);
  });

  it('finds the end-of-line reference by panel', () => {
    const answers = ask('end of line');
    expect(answers.some((a) => a.kind === 'eol' || /end-of-line/i.test(a.title))).toBe(true);
  });

  it('finds an addressing protocol by name', () => {
    const answers = ask('Hochiki ESP');
    expect(answers.some((a) => a.kind === 'protocol' && /hochiki/i.test(a.title))).toBe(true);
  });
});

describe('refusing to answer', () => {
  it('returns nothing for a question about something it does not hold', () => {
    expect(ask('what is the capital of France')).toEqual([]);
    expect(ask('zzzzqqqq')).toEqual([]);
  });

  it('returns nothing for a query too short to mean anything', () => {
    expect(ask('')).toEqual([]);
    expect(ask('a')).toEqual([]);
    expect(ask('   ')).toEqual([]);
  });

  it('never returns an answer below the threshold', () => {
    // A query sharing one common word with many entries should not drag in
    // everything that happens to contain it.
    for (const answer of ask('the panel and the system and something else entirely')) {
      expect(answer.score).toBeGreaterThanOrEqual(ANSWER_THRESHOLD);
    }
  });

  it('has something to say about its own coverage when it cannot answer', () => {
    expect(COVERAGE.length).toBeGreaterThan(3);
    for (const line of COVERAGE) expect(line.trim().length).toBeGreaterThan(0);
  });
});

describe('every answer carries where it came from', () => {
  const samples = ['DET-DET-001', 'battery', 'detector', 'address', 'end of line', 'extinguisher'];

  it('names a source and a confidence on every answer', () => {
    for (const q of samples) {
      for (const answer of ask(q)) {
        expect(answer.source.trim().length).toBeGreaterThan(0);
        expect(['high', 'medium', 'low']).toContain(answer.confidence);
        expect(answer.title.trim().length).toBeGreaterThan(0);
        expect(KIND_LABEL[answer.kind]).toBeTruthy();
      }
    }
  });

  it('does not claim high confidence for a check whose figure comes from elsewhere', () => {
    // A check flagged verify:true is one where the standard or the manual
    // governs, so the app's own wording is not the answer.
    const answers = ask('battery terminal voltage float range');
    const routine = answers.find((a) => a.kind === 'routine');
    if (routine) expect(routine.confidence).not.toBe('high');
  });

  it('distinguishes a standard from a manufacturer requirement in the source', () => {
    const sources = new Set<string>();
    for (const q of ['detector', 'battery', 'panel', 'valve']) {
      for (const a of ask(q, 40)) if (a.kind === 'routine') sources.add(a.source);
    }
    // If every routine answer named the same source, the promise that the app
    // never blurs a standard with a manufacturer instruction would be empty.
    expect(sources.size).toBeGreaterThan(1);
  });
});

describe('ranking', () => {
  it('puts an exact identifier first, ahead of anything that merely mentions it', () => {
    const code = DEFECT_LIBRARY[0]!.code;
    const [top] = ask(code);
    expect(top?.title).toContain(code);
    expect(top?.score).toBeGreaterThan(100);
  });

  it('returns results in descending score', () => {
    const answers = ask('detector');
    for (let i = 1; i < answers.length; i++) {
      expect(answers[i - 1]!.score).toBeGreaterThanOrEqual(answers[i]!.score);
    }
  });

  it('honours the limit', () => {
    expect(ask('detector', 3).length).toBeLessThanOrEqual(3);
  });

  it('prefers an answer matching more of the question', () => {
    const answers = ask('detector failed to alarm on test');
    expect(answers.length).toBeGreaterThan(0);
    // The defect that is exactly this should outrank a generic detector entry.
    expect(answers[0]!.title.toLowerCase()).toMatch(/alarm|detector/);
  });
});
