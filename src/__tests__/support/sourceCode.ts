/**
 * A file's code without its prose, for the sweeps that read source text.
 *
 * Several guards in this suite are written against source text, because the
 * things they guard are components and the suite's react-native mock cannot
 * load one. They look for a call — `listSites(`, `listJobPage(` — and a
 * comment explaining why a screen no longer makes that call matches just as
 * well as the call itself. The customer screen hit exactly that: the call was
 * replaced, the note saying so named it, and the guard failed a screen it had
 * no quarrel with.
 *
 * A guard that cannot tell code from a comment is a guard nobody will trust
 * the third time it cries wolf, so the sweeps strip the prose first.
 *
 * Deliberately narrow. Block comments go whole; a line comment goes only where
 * the line is nothing but a comment. Cutting at any `//` would take the rest
 * of a line holding a URL in a string — and a call after it — which is a
 * missed fault rather than a false one, and the worse of the two mistakes.
 */
export function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}
