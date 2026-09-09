import { isPhrase, phraseWords, readPhrase } from '@/domain/findPhrase';

/**
 * A sentence typed into the search box.
 *
 * The rule the whole module rests on: the words it searches for are always
 * words the person typed. Nothing here may put a name, a number or a term
 * into a search that was not in the phrase, because a search that invents a
 * term answers a question nobody asked and looks just as confident doing it.
 */

describe('telling a phrase from an identifier', () => {
  it('leaves identifiers alone', () => {
    expect(isPhrase('44501')).toBe(false);
    expect(isPhrase('DET-OPT-1')).toBe(false);
    expect(isPhrase('name@example.invalid')).toBe(false);
    expect(isPhrase('0400 000 000')).toBe(false);
    // The search's own prefixes read better than this does.
    expect(isPhrase('po 80375')).toBe(false);
    expect(isPhrase('inv 62339')).toBe(false);
    expect(isPhrase('')).toBe(false);
  });

  it('leaves a two-word name alone, but not two words naming a kind', () => {
    expect(isPhrase('Fictional Tower')).toBe(false);
    expect(isPhrase('unpaid invoices')).toBe(true);
    expect(isPhrase('show invoices')).toBe(true);
  });

  it('reads three words or more as a sentence', () => {
    expect(isPhrase('purchase orders for pumps')).toBe(true);
    expect(isPhrase('who do I ring at the tower')).toBe(true);
  });
});

describe('reading what a phrase asks for', () => {
  it('takes the kind out and keeps the name', () => {
    expect(readPhrase('invoices for Fictional Tower')).toEqual({
      terms: 'Fictional Tower', kind: 'invoice', ignored: [], changed: true,
    });
  });

  it('reads a two-word kind as one word', () => {
    expect(readPhrase('purchase orders for pumps')).toMatchObject({ terms: 'pumps', kind: 'order' });
    expect(readPhrase('work orders at the depot')).toMatchObject({ terms: 'depot', kind: 'job' });
  });

  it('keeps the first kind named, since the rest describe it', () => {
    // Invoices are what was asked for; "job" says which invoices.
    expect(readPhrase('invoices for the job at Fictional Tower')).toMatchObject({ terms: 'Fictional Tower', kind: 'invoice' });
  });

  it('keeps a number in the terms, so the kind and the number go together', () => {
    expect(readPhrase('purchase orders for job 44501')).toMatchObject({ terms: '44501', kind: 'order' });
  });

  it('owns up to the words it cannot act on', () => {
    const read = readPhrase('unpaid invoices for Fictional Tower');
    expect(read).toMatchObject({ terms: 'Fictional Tower', kind: 'invoice', ignored: ['unpaid'] });
    expect(phraseWords(read)).toBe(
      'Read as: invoices only, matching "Fictional Tower", "unpaid" is not something this box can filter on, so it was left out.',
    );
  });

  it('comes back with no terms where every word was scaffolding', () => {
    const read = readPhrase('show me the open purchase orders');
    expect(read).toMatchObject({ terms: '', kind: 'order', ignored: ['open'] });
    expect(phraseWords(read)).toContain('the most recent');
  });

  it('never puts a word into the terms that was not typed', () => {
    const phrases = [
      'who do I ring at Fictional Tower',
      'unpaid invoices for the client at the tower',
      'parts like DET-OPT-1',
      'leads in Yatala',
    ];
    for (const phrase of phrases) {
      const typed = new Set(phrase.toLowerCase().split(/\s+/));
      for (const word of readPhrase(phrase).terms.toLowerCase().split(/\s+/).filter(Boolean)) {
        expect({ phrase, word, typed: typed.has(word) }).toEqual({ phrase, word, typed: true });
      }
    }
  });

  it('says nothing about a phrase it did not change', () => {
    const read = readPhrase('Fictional Tower');
    expect(read).toEqual({ terms: 'Fictional Tower', kind: undefined, ignored: [], changed: false });
    expect(phraseWords(read)).toBeUndefined();
    expect(readPhrase('   ')).toEqual({ terms: '', ignored: [], changed: false });
  });
});
