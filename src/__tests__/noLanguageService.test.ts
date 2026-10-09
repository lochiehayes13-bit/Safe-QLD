import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Nothing in the app sends a technician's words to an outside language
 * service.
 *
 * The owner asked for the app to be "non AI": the standards summary, the
 * defect and note write-ups, the job brief, the label reader and the
 * description-to-cable-size screen were all removed. This keeps them out: a
 * screen or module that brings one back fails here rather than shipping.
 */
const ROOT = join(__dirname, '..', '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name === '__tests__' || name === '__mocks__') return [];
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const FILES = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'src'))];

describe('no outside language service', () => {
  it('reads the whole app', () => {
    expect(FILES.length).toBeGreaterThan(200);
  });

  it.each([
    ['a call to a language model API', /api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis/i],
    ['an import of the removed AI modules', /from '@\/ai\//],
    ['a "Write it up" or "Brief me" button', /title="(Write it up|Brief me)"/],
  ])('has no %s', (_what, pattern) => {
    const hits = FILES.filter((f) => pattern.test(readFileSync(f, 'utf8'))).map((f) => f.slice(ROOT.length + 1));
    expect(hits).toEqual([]);
  });
});
