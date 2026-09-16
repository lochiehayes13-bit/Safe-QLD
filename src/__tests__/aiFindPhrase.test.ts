import {
  FIND_SYSTEM_PROMPT, buildFindPrompt, checkSuggestion, worthAsking,
} from '@/ai/findPhrase';
import { KIND_ORDER } from '@/domain/search';

/**
 * The model may choose which of your words to search for, and nothing else.
 *
 * The harness around it is the feature: what goes up is the phrase alone,
 * and what comes back is dropped unless every word of it was typed. A
 * search for a customer nobody named would be a confident wrong answer, and
 * the person acting on it is standing in a plant room.
 */

describe('what is sent', () => {
  it('is the phrase and the list of kinds, and nothing else', () => {
    const prompt = buildFindPrompt('  anything outstanding with the pump mob  ');
    // Two lines: the app's own vocabulary, and the words typed into the box.
    // No record of any kind is in it, and nothing the phrase did not say.
    expect(prompt).toBe(`Kinds: ${KIND_ORDER.join(', ')}.\nPhrase: anything outstanding with the pump mob`);
    expect(prompt.split('\n')).toHaveLength(2);
  });

  it('tells the model the rules it is checked against', () => {
    expect(FIND_SYSTEM_PROMPT).toContain('only words that appear in the phrase');
    expect(FIND_SYSTEM_PROMPT).toContain('one line of JSON');
    for (const kind of KIND_ORDER) expect(FIND_SYSTEM_PROMPT).toContain(kind);
  });
});

describe('whether to ask at all', () => {
  it('does not ask about a phrase the word lists already read', () => {
    expect(worthAsking('unpaid invoices for Fictional Tower')).toEqual({
      ok: false, reason: 'The phrase was already read without asking.',
    });
  });

  it('does not ask about one word, or a paragraph', () => {
    expect(worthAsking('44501').ok).toBe(false);
    expect(worthAsking(`${'word '.repeat(40)}`).ok).toBe(false);
  });

  it('asks about a phrasing no list has', () => {
    expect(worthAsking('anything happening at the pump mob')).toEqual({ ok: true });
  });
});

describe('checking what came back', () => {
  const phrase = 'anything happening at the pump mob';

  it('takes a subset of the words with a kind the app has', () => {
    expect(checkSuggestion('{"terms": "pump mob", "kind": "customer"}', phrase)).toEqual({
      suggestion: { terms: 'pump mob', kind: 'customer' },
    });
  });

  it('reads an answer wrapped in a code fence or padded with words around the object', () => {
    expect(checkSuggestion('```json\n{"terms": "pump mob"}\n```', phrase).suggestion).toEqual({ terms: 'pump mob', kind: undefined });
    expect(checkSuggestion('Here you go: {"terms": "pump"} — hope that helps', phrase).suggestion).toEqual({ terms: 'pump', kind: undefined });
  });

  it('drops an answer carrying a word nobody typed', () => {
    expect(checkSuggestion('{"terms": "Harbourline pumps", "kind": "customer"}', phrase)).toEqual({
      refusal: 'It came back with a word that was not typed: "harbourline". Left as it was.',
    });
  });

  it('drops a kind the app does not search', () => {
    expect(checkSuggestion('{"terms": "pump", "kind": "timesheet"}', phrase)).toEqual({
      refusal: 'It asked for "timesheet", which is not a kind of record here.',
    });
  });

  it('drops anything that is not one JSON object', () => {
    expect(checkSuggestion('I think you mean the pump company.', phrase).refusal).toBe('The answer was not a search.');
    expect(checkSuggestion('{not json}', phrase).refusal).toBe('The answer was not a search.');
    expect(checkSuggestion('[]', phrase).refusal).toBe('The answer was not a search.');
  });

  it('drops an answer that says nothing', () => {
    expect(checkSuggestion('{"terms": "", "kind": ""}', phrase).refusal).toBe('It made nothing of the phrase either.');
  });

  it('takes a kind on its own, since "the leads" is a search', () => {
    expect(checkSuggestion('{"terms": "", "kind": "lead"}', 'what have we got on the go').suggestion)
      .toEqual({ terms: '', kind: 'lead' });
  });

  it('compares words without their punctuation or case', () => {
    expect(checkSuggestion('{"terms": "Pump"}', "what's happening with the pump?").suggestion).toEqual({ terms: 'Pump', kind: undefined });
  });
});
