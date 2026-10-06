/**
 * A screen opened without a site lets you pick one and comes back.
 *
 * Twelve screens answer a missing site with ContextGate, whose one button
 * pushed the sites tab. The site is findable there — the whole table, the
 * shared search, the cap announced — but every row on that tab opens
 * /site/[id], so the module the person tapped is lost: they land on the site
 * hub and have to find their way back among sixteen tiles.
 *
 * That is not a rare path. The standards library pushes these exact routes
 * with no site more than two hundred times, and the gate's own note names
 * pinned tiles and search as the other two ways in.
 *
 * So the gate picks in place and reopens the screen that was asked for. The
 * route it returns to is the screen's own, which is the part a test has to
 * hold: a wrong pathname here sends somebody to a different module than the
 * one they tapped, and nothing would say so.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const screens = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return screens(path);
  return name.endsWith('.tsx') ? [path] : [];
});

const gated = screens(join(root, 'app'))
  .map((f) => ({ file: f.slice(f.indexOf('/app/') + 1), source: readFileSync(f, 'utf8') }))
  .filter(({ source }) => source.includes('kind="site"'));

describe('the gate itself', () => {
  const gate = read('src/components/ContextGate.tsx');

  it('picks in place rather than sending somebody to the hub', () => {
    expect(gate).toContain('<SitePicker');
    expect(gate).toContain("const pickHere = kind === 'site' && !!backTo;");
  });

  it('reopens the screen that was asked for, with the site on it', () => {
    expect(gate).toMatch(/router\.replace\(\{ pathname: backTo!, params: \{ siteId \} \}/);
  });

  it('keeps the old button where a screen gives it nowhere to come back to', () => {
    // The configuration and asset gates still use it, and a gate with no
    // route must not silently show a picker that goes nowhere.
    expect(gate).toContain('action={pickHere ? undefined : (');
  });

  it('says nothing has failed while the list is being read', () => {
    expect(gate).toContain('Reading the site list…');
  });
});

describe('every screen that asks for a site', () => {
  it('finds them all, so this is not passing on an empty list', () => {
    expect(gated.length).toBeGreaterThanOrEqual(12);
  });

  it.each(gated.map((g) => [g.file, g.source] as const))(
    '%s tells the gate where to come back to',
    (_file, source) => {
      expect(source).toMatch(/kind="site"[^/]*backTo="/);
    },
  );

  it.each(gated.map((g) => [g.file, g.source] as const))(
    '%s names its own route, not another screen’s',
    (file, source) => {
      /*
       * The one thing that would be wrong and silent: a pathname copied from
       * the screen beside it sends somebody to a different module than the one
       * they tapped, with the site they picked, and nothing says so.
       */
      const own = `/${file.replace(/^app\//, '').replace(/\.tsx$/, '')}`;
      const declared = source.match(/backTo="([^"]+)"/)?.[1];
      expect({ file, declared }).toEqual({ file, declared: own });
    },
  );

  it.each(gated.map((g) => [g.file, g.source] as const))(
    '%s reads the site back under the name the gate sends',
    (file, source) => {
      // The gate sends `siteId`. A screen reading some other parameter would
      // come back as empty as it went.
      expect({ file, reads: /useLocalSearchParams<\{[^}]*siteId\?: string/.test(source) })
        .toEqual({ file, reads: true });
    },
  );
});
