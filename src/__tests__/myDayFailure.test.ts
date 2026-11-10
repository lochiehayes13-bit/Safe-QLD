import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { codeOf } from './support/sourceCode';

/**
 * My day says when its read fails, and offers Try again.
 *
 * The screen awaited its reads with no catch, so a read that threw left
 * "Reading the schedule…" on screen for ever. Every other screen that reads
 * on focus shows the failure; this one does now too.
 */

const source = codeOf(readFileSync(join(__dirname, '..', '..', 'app/work/my-day.tsx'), 'utf8'));

describe('My day when the schedule cannot be read', () => {
  it('catches the read and keeps the reason', () => {
    expect(source).toMatch(/catch \(e\) \{\s*if \(live\(\)\) setFailed\(describeLoadFailure\(e, 'your schedule'\)\);/);
  });

  it('shows the failure before the loading line, so it cannot be hidden behind it', () => {
    const failure = source.indexOf('if (failed)');
    const loading = source.indexOf('if (who === undefined)');
    expect(failure).toBeGreaterThan(-1);
    expect(loading).toBeGreaterThan(failure);
  });

  it('offers Try again, which reads once more', () => {
    expect(source).toContain('title="Try again" onPress={() => { void read(() => true); }}');
  });
});
