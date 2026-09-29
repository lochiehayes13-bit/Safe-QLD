import {
  MAX_NOTE_CHARS, NOTE_SYSTEM_PROMPT, buildNotePrompt, checkNote, worthWriting,
} from '@/ai/officeNote';

/**
 * Tidying up a note to the office.
 *
 * The note becomes the company's record of what happened on a site, so the
 * check on the way back is the defect wording's check: a number that was
 * not in the technician's own words is a fact from nowhere, and it is
 * thrown away rather than shown with a caveat. What goes up is the words
 * typed and nothing about the job.
 */

const rough = 'cant finish panel dead need sparky back tues';

describe('what is sent', () => {
  it('is the technician\'s words alone', () => {
    expect(buildNotePrompt(`  ${rough}  `)).toBe(`Technician's words:\n${rough}`);
  });

  it('tells the model the rules it is checked against', () => {
    expect(NOTE_SYSTEM_PROMPT).toContain('Never add a number');
    expect(NOTE_SYSTEM_PROMPT).toContain('never say when someone will attend');
  });
});

describe('whether there is anything to write up', () => {
  it('wants a few words first', () => {
    expect(worthWriting('panel dead')).toEqual({ ok: false, reason: 'Write a few words first and it can be tidied up.' });
    expect(worthWriting(rough)).toEqual({ ok: true });
  });

  it('leaves a long note alone', () => {
    expect(worthWriting('word '.repeat(400)).ok).toBe(false);
  });
});

describe('checking the draft', () => {
  it('splits the subject from the note', () => {
    const draft = checkNote(
      'Panel fault, return needed\n\nThe fire panel was found dead on arrival. The service could not be completed. An electrician is needed before the work can finish.',
      rough,
    );
    expect(draft.subject).toBe('Panel fault, return needed');
    expect(draft.note).toContain('found dead on arrival');
    expect(draft.note).not.toContain('Panel fault, return needed');
  });

  it('takes the whole answer as the note where it wrote no subject', () => {
    const draft = checkNote('The fire panel was found dead. An electrician is needed.', rough);
    expect(draft.subject).toBeUndefined();
    expect(draft.note).toBe('The fire panel was found dead. An electrician is needed.');
  });

  it('refuses a number that was not in the words', () => {
    // "Tuesday the 12th" is a date nobody gave it, and the office would book
    // a technician on it.
    expect(checkNote('Return booked\n\nAn electrician is needed. Returning on the 12th.', rough)).toEqual({
      refusal: 'It wrote a number that was not in your words: "12". Your own words still stand.',
    });
  });

  it('keeps the numbers the technician did write', () => {
    const words = '3 heads failed on level 2, 10 more to test';
    const draft = checkNote('Three heads failed\n\nOn level 2, 3 sprinkler heads failed the test. 10 remain to be tested.', words);
    expect(draft.refusal).toBeUndefined();
    expect(draft.note).toContain('level 2');
  });

  it('refuses padding, and an empty answer', () => {
    expect(checkNote(`Subject\n\n${'word '.repeat(MAX_NOTE_CHARS)}`, rough).refusal)
      .toBe('What came back was longer than the note itself. Your own words still stand.');
    expect(checkNote('   ', rough).refusal).toBe('Nothing came back. Your own words still stand.');
  });

  it('drops a "Subject:" label the model wrote anyway', () => {
    expect(checkNote('Subject: Panel fault\n\nThe panel was dead.', rough).subject).toBe('Panel fault');
  });
});
