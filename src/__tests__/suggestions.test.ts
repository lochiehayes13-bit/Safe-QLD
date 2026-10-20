import {
  SUGGESTION_TAG, suggestionBody, suggestionNotReady, suggestionSubject, type Suggestion,
} from '@/domain/suggestions';

function s(over: Partial<Suggestion> = {}): Suggestion {
  return {
    technicianName: 'Lachlan Hayes',
    kind: 'idea',
    screen: 'Resistor values',
    text: 'Let me type the ohms and get the colour bands back, not just the other way round.',
    appVersion: '0.1.0',
    ...over,
  };
}

describe('the subject line', () => {
  it('starts with the tag, every time, so an inbox rule can file it', () => {
    expect(suggestionSubject(s()).startsWith(`${SUGGESTION_TAG} `)).toBe(true);
    expect(suggestionSubject(s({ kind: 'problem', screen: '' })).startsWith(`${SUGGESTION_TAG} `)).toBe(true);
  });

  it('says what kind of thing it is and where, then who', () => {
    expect(suggestionSubject(s())).toBe('[Safe QLD app] Idea — Resistor values — Lachlan Hayes');
  });

  it('copes with no screen named', () => {
    expect(suggestionSubject(s({ screen: '  ' }))).toBe('[Safe QLD app] Idea — Lachlan Hayes');
  });

  it('calls a problem a problem', () => {
    expect(suggestionSubject(s({ kind: 'problem' }))).toContain('Something wrong');
  });
});

describe('the body', () => {
  it('carries the words the technician wrote, untouched', () => {
    expect(suggestionBody(s())).toContain('Let me type the ohms and get the colour bands back');
  });

  it('names the build, so a fixed problem is not chased twice', () => {
    expect(suggestionBody(s())).toContain('App version: 0.1.0');
  });

  it('leaves the version line out when the build is unknown rather than printing a blank', () => {
    expect(suggestionBody(s({ appVersion: '' }))).not.toMatch(/App version/);
  });
});

describe('what stops it going', () => {
  it('needs a name, so somebody can be asked what they meant', () => {
    expect(suggestionNotReady(s({ technicianName: '' }))).toMatch(/set your name/i);
  });

  it('needs more than a grunt', () => {
    expect(suggestionNotReady(s({ text: 'broken' }))).toMatch(/say a little more/i);
  });

  it('lets a real one through', () => {
    expect(suggestionNotReady(s())).toBeNull();
  });
});
