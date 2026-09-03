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
