/**
 * The head tags the exported shell does not have, and the one function that
 * puts them in. Kept apart from the script that reads and writes files so a
 * test can hold it to what it promises.
 */

/** The dark ground of the app, so a slow first load is not a white flash. */
const GROUND = '#0B0D10';

const TAGS = `
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, shrink-to-fit=no, viewport-fit=cover" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Safe QLD" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="theme-color" content="${GROUND}" />
    <meta name="description" content="Safe QLD field application: the office's jobs, sites, assets, forms and standards, on the phone." />
    <link rel="apple-touch-icon" href="./icon.png" />
    <link rel="manifest" href="./manifest.webmanifest" />
    <style id="safeqld-ground">
      html, body { background-color: ${GROUND}; }
      body { overscroll-behavior: none; -webkit-tap-highlight-color: transparent; }
    </style>
`;

/**
 * Adds the tags, replacing the export's own viewport line rather than leaving
 * two: a second viewport tag is not an error anywhere, it simply loses, and
 * which one loses is not something to leave to a browser.
 *
 * Running it twice changes nothing, because a build step that is not
 * idempotent is a build step that breaks the day somebody runs it twice.
 */
function injectShell(html) {
  if (html.includes('id="safeqld-ground"')) return html;
  const withoutViewport = html.replace(/[ \t]*<meta\s+name="viewport"[^>]*>\n?/g, '');
  if (!withoutViewport.includes('</head>')) throw new Error('the exported index.html has no </head> to write into');
  return withoutViewport.replace('</head>', `${TAGS}  </head>`);
}

module.exports = { injectShell, GROUND };
