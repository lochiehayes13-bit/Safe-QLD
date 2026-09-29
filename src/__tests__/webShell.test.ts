import * as SIGNAL from '@/web/updateSignal';
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
const {
  serviceWorkerSource, REGISTRATION,
  UPDATE_READY_FLAG, UPDATE_READY_EVENT, APPLY_UPDATE_FUNCTION, FRESH_PAGE_MS,
} = require('../../scripts/webServiceWorker') as {
  serviceWorkerSource: (files: string[]) => string;
  REGISTRATION: string;
  UPDATE_READY_FLAG: string;
  UPDATE_READY_EVENT: string;
  APPLY_UPDATE_FUNCTION: string;
  FRESH_PAGE_MS: number;
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

  it('registers the worker from where the app lives, not from the page that is open', () => {
    // './sw.js' on /work/timesheets asks the host for /work/sw.js, which is
    // not there, and the registration fails silently — leaving the app
    // online-only for exactly the person who followed a link to a screen.
    expect(shell).toContain('_expo/static/js/web/');
    expect(shell).toContain("register(root + 'sw.js'");
    expect(shell).not.toContain("register('./sw.js')");
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
    expect(source).toContain('.catch(() => {})');
    expect(source).toContain('FILES.map(');
  });

  it('fills the new cache from the server, not from the browser’s own copy', () => {
    // A plain cache.add goes through the HTTP cache, and this site is served
    // with max-age=600 — so inside ten minutes of a deployment the cache named
    // after the NEW build could be filled with the PREVIOUS index.html, which
    // names a bundle that is no longer on the server. That pairing then serves
    // forever: a shell pointing at a 404.
    expect(source).toContain("new Request(f, { cache: 'reload' })");
  });

  it('goes looking for a newer build on every navigation', () => {
    expect(source).toContain('self.registration.update()');
  });

  it('answers a file it has never seen and cannot fetch, rather than rejecting', () => {
    // A rejected respondWith reaches the page as a network error it cannot
    // tell apart from a broken app.
    expect(source).toContain("new Response('', { status: 504");
  });

  it('looks in the build it is replacing before the network, and nowhere else on the origin', () => {
    // caches.match searches every cache on the origin, and this app shares
    // github.io with whatever else the owner has published there.
    expect(source).not.toContain('caches.match(');
    expect(source).toContain("!key.startsWith('safeqld-')");
  });

  it('is valid JavaScript, which a string of it assembled by hand is not always', () => {
    expect(() => new Function(source.replace(/^\/\* Generated[^\n]*\n/, ''))).not.toThrow();
  });

  /**
   * The owner opened the app and twenty documents published that morning were
   * not in it. Nothing was wrong with the site; there was no way out of the
   * cache. These are the three things that were missing, each pinned so the
   * next person to tidy this file cannot quietly put the app back in it.
   */
  it('waits rather than activating under the page that is still showing', () => {
    // skipWaiting during install deletes the old cache under a running page,
    // and the files it then asks the server for are gone: a Pages deployment
    // replaces the whole site, hashed names and all.
    const install = source.slice(source.indexOf("addEventListener('install'"), source.indexOf("addEventListener('message'"));
    expect(install).not.toContain('skipWaiting');
  });

  it('takes the new build when the page asks, and only then', () => {
    expect(source).toContain("event.data.type === 'SKIP_WAITING'");
    expect(source).toContain('self.skipWaiting()');
  });

  it('claims the page once it does activate, so the next request is answered by the new build', () => {
    expect(source).toContain('self.clients.claim()');
  });
});

/**
 * Being able to leave the cache, which is the half that was missing.
 *
 * The browser only looks for a new worker when it navigates, and an app added
 * to a home screen and left running never does. So the page has to ask, and it
 * has to be able to tell somebody when the answer is yes.
 */
describe('how the page finds out a new build exists', () => {
  const shell = injectShell(EXPORTED);

  it('asks for sw.js rather than rereading the copy the CDN gave it', () => {
    expect(shell).toContain("updateViaCache: 'none'");
  });

  it('asks on load, on a timer, when the tab comes back, and when the signal returns', () => {
    expect(shell).toContain('reg.update()');
    expect(shell).toContain('setInterval(check');
    expect(shell).toContain("document.addEventListener('visibilitychange'");
    expect(shell).toContain("window.addEventListener('online', check)");
  });

  it('reloads only where this page asked for it', () => {
    // A reload nobody asked for, in the middle of a form, is worse than a
    // stale tab. `applying` is set only by apply().
    expect(shell).toContain("navigator.serviceWorker.addEventListener('controllerchange'");
    expect(shell).toContain('if (applying) window.location.reload()');
  });

  it('takes a new build on its own only while the page is too young to have anything on it', () => {
    expect(shell).toContain(`(Date.now() - opened) < FRESH_PAGE_MS`);
    expect(shell).toContain(`var FRESH_PAGE_MS = ${FRESH_PAGE_MS};`);
    expect(FRESH_PAGE_MS).toBeLessThanOrEqual(60_000);
  });

  it('can do that at most once per tab, so a bad build cannot make a reload loop', () => {
    expect(shell).toContain('!tookOneAlready()');
    expect(shell).toContain("sessionStorage.setItem(TOOK_ONE, '1')");
  });

  it('says nothing on the very first install, which replaces nothing', () => {
    // Without the controller test, a first visit would announce an update to
    // somebody who has just arrived.
    expect(shell).toContain('navigator.serviceWorker.controller) offer(reg.waiting)');
    expect(shell).toContain("arriving.state === 'installed' && navigator.serviceWorker.controller");
  });

  it('survives a browser with no session storage rather than failing to update at all', () => {
    expect(shell).toContain('catch (e) { return false; }');
  });

  it('is valid JavaScript, which a string of it assembled by hand is not always', () => {
    // It is inline script in the head of a page: a stray backtick or an
    // unbalanced brace is a page that does not run at all, and the typechecker
    // and the linter both look straight past a template literal.
    expect(() => new Function(REGISTRATION)).not.toThrow();
  });

  /**
   * Three names agreed in two places — a build script and a React component —
   * which is exactly the kind of thing that drifts the day one is renamed.
   */
  it('uses the same three names the app listens on', () => {
    expect(UPDATE_READY_FLAG).toBe(SIGNAL.UPDATE_READY_FLAG);
    expect(UPDATE_READY_EVENT).toBe(SIGNAL.UPDATE_READY_EVENT);
    expect(APPLY_UPDATE_FUNCTION).toBe(SIGNAL.APPLY_UPDATE_FUNCTION);

    expect(shell).toContain(`window.${UPDATE_READY_FLAG} = true`);
    expect(shell).toContain(`new CustomEvent('${UPDATE_READY_EVENT}')`);
    expect(shell).toContain(`window.${APPLY_UPDATE_FUNCTION} = apply`);
  });
});
