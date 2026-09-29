import {
  chosenButton, dialogText, isQuestion, labelledText, type AlertChoice,
} from '@/domain/alertChoice';

/**
 * Every message this app raises, on the build that reaches an iPhone.
 *
 * `react-native-web`'s Alert is `static alert() {}`. A hundred and seventy-odd
 * messages — "Photo required", "Not ready to send", the confirmation before a
 * rectification date is stamped — went nowhere in a browser, which is where
 * this app runs on iOS. These are the rules the browser version follows.
 */

const CANCEL: AlertChoice = { text: 'Cancel', style: 'cancel' };

describe('a statement and a question', () => {
  it('tells with one button and asks with two', () => {
    expect(isQuestion(undefined)).toBe(false);
    expect(isQuestion([])).toBe(false);
    expect(isQuestion([{ text: 'OK' }])).toBe(false);
    expect(isQuestion([CANCEL, { text: 'Rectified' }])).toBe(true);
  });

  it('joins the title and the body, because a browser prompt takes one string', () => {
    expect(dialogText('Photo required', 'Add one before saving.'))
      .toBe('Photo required\n\nAdd one before saving.');
    expect(dialogText('Sent')).toBe('Sent');
    expect(dialogText('Sent', '   ')).toBe('Sent');
  });
});

describe('which button ran', () => {
  it('runs the one that goes ahead when the person agreed', () => {
    const go: AlertChoice = { text: 'Rectified' };
    expect(chosenButton([CANCEL, go], true)).toBe(go);
  });

  it('runs the cancelling one when they did not, whatever order it is in', () => {
    /*
     * A dismissed browser dialog — Escape, or the tab losing focus — comes back
     * false, and several of these alerts put the screen back in their cancel
     * branch. Treating a dismissal as "nothing happened" would leave the screen
     * half way through an action nobody finished.
     */
    const go: AlertChoice = { text: 'Reopen', style: 'destructive' };
    expect(chosenButton([CANCEL, go], false)).toBe(CANCEL);
    expect(chosenButton([go, CANCEL], false)).toBe(CANCEL);
  });

  it('never runs a destructive action the person did not agree to', () => {
    // The whole reason this is a `confirm` rather than an `alert`.
    const destructive: AlertChoice = { text: 'Delete', style: 'destructive' };
    expect(chosenButton([CANCEL, destructive], false)).not.toBe(destructive);
  });

  it('treats a single button as the answer, since it is the only one', () => {
    const ok: AlertChoice = { text: 'OK' };
    expect(chosenButton([ok], true)).toBe(ok);
  });

  it('has nothing to run when the alert carried no buttons', () => {
    expect(chosenButton(undefined, true)).toBeUndefined();
    expect(chosenButton([], true)).toBeUndefined();
  });

  it('falls back to the cancel when it is the only button there is', () => {
    expect(chosenButton([CANCEL], true)).toBe(CANCEL);
  });
});

describe('what the browser dialog reads', () => {
  it('names the actions, because a browser will not relabel OK and Cancel', () => {
    /*
     * "Mark this defect rectified? … OK" does not say what OK does, and this
     * one stamps a statutory date. The labels the phone would have shown go
     * into the text instead.
     */
    const said = labelledText(
      'Mark this defect rectified?',
      'This records today as the rectification date.',
      [CANCEL, { text: 'Rectified' }],
    );
    expect(said).toContain('OK — Rectified');
    expect(said).toContain('Cancel — Cancel');
  });

  it('leaves a plain statement alone', () => {
    expect(labelledText('Sent', 'Your week has gone to accounts.', [{ text: 'OK' }]))
      .toBe('Sent\n\nYour week has gone to accounts.');
  });
});
