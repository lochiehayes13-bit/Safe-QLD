import { decodeEntities, firstLine, htmlToText, looksLikeHtml } from '@/domain/simproText';

/**
 * The office's rich text, made plain.
 *
 * Simpro hands job descriptions back as the HTML its editor produced. The
 * fixtures below are that editor's shapes — the `font-size: 10pt` div, the
 * strong tag, the non-breaking space — with made-up words in them.
 */

describe('htmlToText', () => {
  it('keeps the paragraph breaks the writer meant and drops the markup', () => {
    const html = '<div style="font-size: 10pt;">Six monthly service.</div>'
      + '<div style="font-size: 10pt;"><strong>Access:</strong> key in lockbox</div>';
    expect(htmlToText(html)).toBe('Six monthly service.\nAccess: key in lockbox');
  });

  it('turns line breaks and list items into lines', () => {
    expect(htmlToText('One<br>Two<br/>Three')).toBe('One\nTwo\nThree');
    expect(htmlToText('<ul><li>Panel</li><li>Pump</li></ul>')).toBe('- Panel\n- Pump');
  });

  it('decodes the entities the editor writes', () => {
    expect(htmlToText('Smith &amp; Co &#8211; level&nbsp;2 &lt;east&gt;')).toBe('Smith & Co – level 2 <east>');
    expect(decodeEntities('&#x27;quoted&#x27; &unknown;')).toBe("'quoted' &unknown;");
  });

  it('collapses runs of blank lines to one and trims each line', () => {
    expect(htmlToText('<p>  a  </p><p></p><p></p><p>b</p>')).toBe('a\n\nb');
  });

  it('leaves plain text alone apart from trimming', () => {
    expect(htmlToText('  Replace the batteries.  ')).toBe('Replace the batteries.');
    expect(htmlToText('line one\r\nline two')).toBe('line one\nline two');
    expect(htmlToText(undefined)).toBe('');
    expect(htmlToText(null)).toBe('');
  });

  it('drops script and style bodies whole', () => {
    expect(htmlToText('<style>p{}</style><p>kept</p><script>x()</script>')).toBe('kept');
  });
});

describe('looksLikeHtml', () => {
  it('spots tags and entities and nothing else', () => {
    expect(looksLikeHtml('<div>x</div>')).toBe(true);
    expect(looksLikeHtml('a &amp; b')).toBe(true);
    expect(looksLikeHtml('a < b and c > d')).toBe(false);
    expect(looksLikeHtml('plain')).toBe(false);
  });
});

describe('firstLine', () => {
  it('takes the first non-blank line and cuts at a word', () => {
    expect(firstLine('\n\n  Replace the smoke detector on level two near the lift\nsecond')).toBe(
      'Replace the smoke detector on level two near the lift',
    );
    expect(firstLine('Replace the smoke detector on level two near the lift', 30)).toBe('Replace the smoke detector on…');
    expect(firstLine(undefined)).toBe('');
  });
});
