/**
 * The web build is the only way this app reaches an iPhone, and what makes it
 * feel like an app rather than a web page is four lines in the `<head>`. Expo's
 * single-page export does not write them, so a build step does — and a build
 * step nobody tests is a build step that silently stops working.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { injectShell, GROUND } = require('../../scripts/webShellHtml') as {
  injectShell: (html: string) => string; GROUND: string;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { serviceWorkerSource } = require('../../scripts/webServiceWorker') as {
  serviceWorkerSource: (files: string[]) => string;
};

/** What `npx expo export --platform web` actually writes, trimmed. */
const EXPORTED = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '  <head>',
  '    <meta charset="utf-8" />',
  '    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />',
  '    <title>Safe QLD</title>',
  '  <link rel="icon" href="/favicon.ico"/></head>',
  '  <body><div id="root"></div>',
  '  <script src="/_expo/static/js/web/index-abc.js" defer></script>',
  '</body>',
  '</html>',
].join('\n');

describe('the web shell', () => {
  const shell = injectShell(EXPORTED);

  it('says the page may run full screen from an iPhone home screen', () => {
    expect(shell).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(shell).toContain('name="apple-mobile-web-app-title" content="Safe QLD"');
  });

  it('leaves exactly one viewport, and it is the one that covers the notch', () => {
    const viewports = shell.match(/name="viewport"/g) ?? [];
    expect(viewports).toHaveLength(1);
    expect(shell).toContain('viewport-fit=cover');
  });

  it('paints the ground before the bundle arrives, so a slow load is not a white flash', () => {
    expect(shell).toContain(`background-color: ${GROUND}`);
  });

  it('points at the icon and the manifest with relative paths, so a project page works', () => {
    expect(shell).toContain('href="./icon.png"');
    expect(shell).toContain('href="./manifest.webmanifest"');
  });

  it('keeps the bundle and the root element it was given', () => {
    expect(shell).toContain('<div id="root"></div>');
    expect(shell).toContain('/_expo/static/js/web/index-abc.js');
  });

  it('changes nothing the second time, because a build step gets run twice', () => {
    expect(injectShell(shell)).toBe(shell);
  });

  it('refuses a page it cannot write into rather than returning it unchanged', () => {
    expect(() => injectShell('<html><body>no head here</body></html>')).toThrow(/no <\/head>/);
  });
});

/**
 * A browser with no signal is no use in a plant room, so the web build carries
 * its own copy. The worker that does it is generated from the export, because
 * every build hashes its own file names.
 */
describe('the service worker', () => {
  const files = ['index.html', '404.html', 'sw.js', 'icon.png', '_expo/static/js/web/index-abc.js', 'assets/font-1.ttf'];
  const source = serviceWorkerSource(files);

  it('caches the app and its assets', () => {
    expect(source).toContain('"./index.html"');
    expect(source).toContain('"./_expo/static/js/web/index-abc.js"');
    expect(source).toContain('"./assets/font-1.ttf"');
  });

  it('does not try to cache itself or the fallback copy of the page', () => {
    expect(source).not.toContain('"./sw.js"');
    expect(source).not.toContain('"./404.html"');
  });

  it('answers a deep link with the app, because a static host has no router', () => {
    expect(source).toContain("request.mode === 'navigate'");
    expect(source).toContain("cache.match('./index.html')");
  });

  it('names its cache after the build, and throws the last one away', () => {
    expect(source).toMatch(/const CACHE = 'safeqld-[0-9a-f]{12}'/);
    expect(source).toContain('caches.delete(key)');
  });

  it('gives the same build the same cache name, and a changed build a new one', () => {
    expect(serviceWorkerSource([...files].reverse())).toBe(source);
    expect(serviceWorkerSource([...files, 'assets/font-2.ttf'])).not.toBe(source);
  });

  it('survives one file failing to cache, rather than installing nothing', () => {
    expect(source).toContain('cache.add(f).catch(() => {})');
  });
});
