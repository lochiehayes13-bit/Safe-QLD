import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { MAILTO_LIMIT, TRIMMED_NOTE, fitBody, mailtoUrl } from '@/domain/mailDraft';
import { timesheetBody, timesheetSubject } from '@/domain/timesheetEmail';
import type { Timesheet, TimesheetEntry } from '@/domain/timesheet';

/**
 * The plus signs.
 *
 * A timesheet reached payroll reading
 * `Timesheet+—+Lachlan+Hayes+—+week+starting+09/09/2026`, with a plus between
 * every word of the subject and every word of the body. Nothing in the wording
 * was wrong: `timesheetBody` had put real spaces there. The link that carried
 * it was built with `URLSearchParams`, which form-encodes, and form encoding
 * writes a space as `+` — a convention that belongs to HTML forms and that a
 * mail client reading a `mailto:` does not share. It unescapes `%20` and leaves
 * `+` where it finds it.
 *
 * So these are the tests that hold the encoder to percent-encoding. The first
 * describe block is the fault itself, pinned on the exact strings from the
 * email that was received.
 */

function entry(over: Partial<TimesheetEntry> = {}): TimesheetEntry {
  return {
    id: 'e1',
    date: '2026-09-09',
    jobNumber: '12001',
    siteName: 'Example Plaza',
    serviceReportNumber: '',
    startTime: '06:30',
    finishTime: '14:30',
    hourKind: 'ord',
    sick: '', rdo: '', annual: '', lwop: '', publicHoliday: '',
    comments: '',
    ...over,
  };
}

function sheet(over: Partial<Timesheet> = {}): Timesheet {
  return {
    id: 't1',
    employeeName: 'Lachlan Hayes',
    vehicleRego: '',
    kilometerReading: '',
    weekStarting: '2026-09-09',
    entries: [entry(), entry({ id: 'e2', date: '2026-09-10' })],
    managerName: '',
    checkedBy: '',
    status: 'draft',
    createdAt: '2026-09-09T06:00:00+10:00',
    updatedAt: '2026-09-09T06:00:00+10:00',
    ...over,
  };
}

describe('no plus ever reaches an inbox', () => {
  it('writes a space as %20, not as +', () => {
    const url = mailtoUrl({ to: 'accounts@example.com', subject: 'Two words', body: 'Two words' });
    expect(url).toContain('subject=Two%20words');
    expect(url).toContain('body=Two%20words');
    expect(url).not.toContain('+');
  });

  it('leaves no + anywhere in the timesheet email that produced this fault', () => {
    // The subject and body from the email that arrived, built the same way the
    // screen builds them.
    const s = sheet();
    const url = mailtoUrl({
      to: 'accounts@example.com',
      subject: timesheetSubject(s),
      body: timesheetBody(s),
    });
    expect(url).not.toContain('+');
    // Every space a %20, the em dashes as their UTF-8 bytes, and the slashes
    // of the date escaped — legal in a query either way, and unambiguous.
    expect(url).toContain(
      'subject=Timesheet%20%E2%80%94%20Lachlan%20Hayes%20%E2%80%94%20week%20starting%2009%2F09%2F2026',
    );
    // The lines that came through as `Ordinary++40` and `TOTAL++40`: two
    // spaces, which is two `%20`, and no plus between them.
    expect(url).toContain('Ordinary%20%2016');
    expect(url).toContain('TOTAL%20%2016');
    // And the closing line, which arrived as
    // `Sent+from+Safe+QLD+on+the+technician's+phone.`
    expect(url).toContain("Sent%20from%20Safe%20QLD%20on%20the%20technician's%20phone.");
  });

  it('holds for anything a technician might type', () => {
    // Every printable ASCII character, a curly apostrophe, an em dash and a
    // newline. If any encoding path produced a `+` for a space this fails.
    const body = [
      ' !"#$%&\'()*+,-./0123456789:;<=>?@',
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`',
      'abcdefghijklmnopqrstuvwxyz{|}~',
      'don’t — 30 m², 240 Ω, 5 °C',
    ].join('\n');
    const url = mailtoUrl({ to: 'a@example.com', subject: body, body });
    // One plus was typed, on the first line. It survives as its escape, so it
    // arrives as a plus — and there is no bare + left to be read as a space.
    expect(url).toContain('%2B');
    expect(url).not.toContain('+');
  });

  it('keeps a plus that belongs there, like a phone number', () => {
    const url = mailtoUrl({ to: 'a@example.com', subject: 'x', body: 'Call +61 400 000 000' });
    expect(url).toContain('Call%20%2B61%20400%20000%20000');
    expect(url).not.toContain('+');
  });

  it('writes a newline as %0A, so the day rows stay on their own lines', () => {
    const url = mailtoUrl({ to: 'a@example.com', subject: 'x', body: 'one\ntwo' });
    expect(url).toContain('body=one%0Atwo');
  });

  it('escapes the characters that would otherwise end the field', () => {
    const url = mailtoUrl({ to: 'a@example.com', subject: 'A & B ? C # D', body: 'x' });
    // An unescaped & would start a second field and an unescaped # would cut
    // the link — both lose the rest of the subject silently.
    expect(url).toContain('subject=A%20%26%20B%20%3F%20C%20%23%20D');
  });
});

describe('the address', () => {
  it('leaves the @ alone, because a mail client reads it as syntax', () => {
    expect(mailtoUrl({ to: 'accounts@example.com', subject: '', body: '' }))
      .toBe('mailto:accounts@example.com');
  });

  it('joins several recipients with a comma, as the scheme says', () => {
    expect(mailtoUrl({ to: ['a@example.com', 'b@example.com'], subject: '', body: '' }))
      .toBe('mailto:a@example.com,b@example.com');
  });

  it('drops blanks rather than addressing an email to nothing', () => {
    expect(mailtoUrl({ to: ['  ', 'a@example.com', ''], subject: '', body: '' }))
      .toBe('mailto:a@example.com');
  });

  it('trims, because a pasted address carries a space', () => {
    expect(mailtoUrl({ to: '  a@example.com ', subject: '', body: '' }))
      .toBe('mailto:a@example.com');
  });
});

describe('the fields', () => {
  it('leaves out a subject or body there is nothing in', () => {
    expect(mailtoUrl({ to: 'a@example.com', subject: '  ', body: '' })).toBe('mailto:a@example.com');
    expect(mailtoUrl({ to: 'a@example.com', subject: 'x', body: '' })).toBe('mailto:a@example.com?subject=x');
  });

  it('separates subject and body with a single &', () => {
    expect(mailtoUrl({ to: 'a@example.com', subject: 'x', body: 'y' }))
      .toBe('mailto:a@example.com?subject=x&body=y');
  });
});

describe('a body too long for the link', () => {
  it('leaves a body that fits exactly as it is', () => {
    const body = 'a\nb\nc';
    expect(fitBody(body)).toBe(body);
  });

  it('cuts on a line boundary, never mid-line', () => {
    // Half a line of a day's hours reads as the day's hours, and somebody
    // would work from it.
    const body = Array.from({ length: 400 }, (_, i) => `Day ${i} — 8h 06:30–14:30`).join('\n');
    const out = fitBody(body);
    expect(out.length).toBeLessThanOrEqual(MAILTO_LIMIT);
    for (const line of out.split('\n')) {
      if (!line || line === TRIMMED_NOTE) continue;
      expect(body.split('\n')).toContain(line);
    }
  });

  it('says it was shortened, because a body that stops mid-week reads as the week', () => {
    const out = fitBody('x'.repeat(5000));
    expect(out).toContain(TRIMMED_NOTE);
  });

  it('still produces a link when one line is longer than the whole limit', () => {
    const out = fitBody('x'.repeat(5000).concat('\nsecond'));
    expect(out).toBe(TRIMMED_NOTE);
    expect(mailtoUrl({ to: 'a@example.com', subject: 's', body: 'x'.repeat(5000) }))
      .toContain(encodeURIComponent(TRIMMED_NOTE));
  });

  it('shortens the body inside the link too, not only when asked directly', () => {
    const url = mailtoUrl({ to: 'a@example.com', subject: 's', body: 'line\n'.repeat(1000) }, 200);
    expect(url).toContain(encodeURIComponent(TRIMMED_NOTE));
  });
});

describe('the two mail layers', () => {
  /** The same guard the file layers have: a name on one side and not the other. */
  const exportsOf = (file: string): string[] => {
    const source = readFileSync(join(__dirname, '..', 'export', file), 'utf8');
    return [
      ...source.matchAll(/^export (?:async function|function|const|type) (\w+)/gm),
    ].map((m) => m[1]!).sort();
  };

  it('offer the screens the same names', () => {
    expect(exportsOf('mail.ts')).toEqual(exportsOf('mail.web.ts'));
  });

  it('are the only mail layer, so a third one cannot drift from them', () => {
    const files = readdirSync(join(__dirname, '..', 'export')).filter((f) => /^mail\./.test(f));
    expect(files.sort()).toEqual(['mail.ts', 'mail.web.ts']);
  });

  it('agree on what the outcomes are called', () => {
    const phone = readFileSync(join(__dirname, '..', 'export', 'mail.ts'), 'utf8');
    const browser = readFileSync(join(__dirname, '..', 'export', 'mail.web.ts'), 'utf8');
    for (const outcome of ['sent', 'not-sent', 'handed-over', 'no-mail-app']) {
      expect(phone).toContain(`'${outcome}'`);
      expect(browser).toContain(`'${outcome}'`);
    }
  });

  it('are the only door to the mail composer, so no screen can go round them', () => {
    // Six screens each opened `expo-mail-composer` themselves, and every one
    // of them inherited the browser half's form encoding and its silently
    // dropped attachments. Reaching it from anywhere but here brings both back.
    const roots = [join(__dirname, '..', '..', 'app'), join(__dirname, '..')];
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(entry.name)) out.push(full);
      }
      return out;
    };
    const importers = roots
      .flatMap((r) => walk(r))
      .filter((f) => /^import .*from 'expo-mail-composer'/m.test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(join(__dirname, '..', '..'), '').replace(/^\//, ''));
    expect(importers).toEqual(['src/export/mail.ts']);
  });

  it('never build a link with the form encoder that caused this', () => {
    // Named in the comments, which is where it belongs — but never called.
    const called = /new URLSearchParams|\.searchParams/;
    for (const file of [
      join(__dirname, '..', 'export', 'mail.ts'),
      join(__dirname, '..', 'export', 'mail.web.ts'),
      join(__dirname, '..', 'domain', 'mailDraft.ts'),
    ]) {
      expect(readFileSync(file, 'utf8')).not.toMatch(called);
    }
  });
});
