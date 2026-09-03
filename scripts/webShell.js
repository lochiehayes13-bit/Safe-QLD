#!/usr/bin/env node
/**
 * Finishes the exported web app so it behaves like an app on a phone.
 *
 * Expo's single-page export writes a plain shell: a title, a viewport, and the
 * bundle. That is enough for a browser tab and not enough for the thing this
 * build exists for — a link somebody opens on an iPhone and adds to their home
 * screen. Four things are missing, and they are all `<head>` tags, so rather
 * than switching the whole export to static rendering (which would have to run
 * every screen through Node at build time, database and all) they are put in
 * afterwards.
 *
 *   node scripts/webShell.js web-build
 *
 * Also writes 404.html, because a static host has no router: on GitHub Pages a
 * deep link like /work/timesheets is a miss, and the 404 page is what answers
 * it. Serving the app there hands the path to the router, which knows it.
 */
const fs = require('fs');
const path = require('path');

const { injectShell } = require('./webShellHtml');
const { serviceWorkerSource } = require('./webServiceWorker');

/** Every file in the export, as paths the server will serve. */
function listFiles(root, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(root, rel));
    else out.push(rel);
  }
  return out;
}

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/webShell.js <export directory>');
  process.exit(2);
}

const indexPath = path.join(dir, 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');
const finished = injectShell(html);
fs.writeFileSync(indexPath, finished);
fs.writeFileSync(path.join(dir, '404.html'), finished);
// GitHub Pages runs Jekyll over what it serves unless told not to, and Jekyll
// hides every directory whose name starts with an underscore — which is where
// the entire bundle lives.
fs.writeFileSync(path.join(dir, '.nojekyll'), '');

// The service worker is written from the finished export, so its list names
// the files that are actually there, hashed names and all.
const worker = serviceWorkerSource(listFiles(dir));
fs.writeFileSync(path.join(dir, 'sw.js'), worker);

console.log(`web shell written into ${indexPath}, copied to 404.html; sw.js caches ${listFiles(dir).length - 3} files`);
