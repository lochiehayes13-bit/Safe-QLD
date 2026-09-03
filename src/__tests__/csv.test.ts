import { parseDelimited, sniffDelimiter, toCsv } from '@/parsers/csv';

/**
 * Reading delimited text, which is how most panel tools and every asset
 * register actually leave their vendor.
 *
 * The failures that matter here are quiet ones. A misread delimiter does not
 * throw — it produces one enormous column, or splits a device description in
 * half at the comma somebody typed in it, and the import screen then shows a
 * plausible-looking mapping over rubbish. A dropped BOM corrupts exactly one
 * field, the first header, which is the one every column mapping hangs off.
 */

describe('sniffDelimiter', () => {
  it('picks the comma in ordinary CSV', () => {
    expect(sniffDelimiter('a,b,c\n1,2,3\n4,5,6')).toBe(',');
  });

  it('picks the tab in a tab-separated export', () => {
    expect(sniffDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
  });

  it('picks the semicolon a European-locale Excel writes', () => {
    expect(sniffDelimiter('a;b;c\n1;2;3\n4;5;6')).toBe(';');
  });

  it('prefers consistency over raw frequency', () => {
    /*
     * The real case. Device text is full of commas — "Detector, level 3, east"
     * — and a file that is genuinely tab-separated has more commas in it than
     * tabs. Counting commas would split every description in half.
     */
    const text = [
      'ref\tdescription\tzone',
      'D1\tDetector, level 3, east\t1',
      'D2\tSounder, stair 2, landing\t2',
      'D3\tCall point, foyer, north\t1',
    ].join('\n');
    expect(sniffDelimiter(text)).toBe('\t');
  });

  it('reads a genuinely two-column export as two columns', () => {
    /*
     * Two columns is a real export — a code and a description, a key and a
     * value — and a delimiter that yields two fields is doing its job.
     * Requiring three leaves a tab-separated pair falling through to the
     * comma, which finds no delimiter at all and returns the whole line as one
     * column. Every row then imports as a single unnamed field.
     */
    expect(sniffDelimiter('code\tdescription\nEXT-01\tExtinguisher')).toBe('\t');
    expect(sniffDelimiter('code;description\nEXT-01;Extinguisher')).toBe(';');
  });

  it('falls back to a comma rather than guessing from nothing', () => {
    expect(sniffDelimiter('')).toBe(',');
    expect(sniffDelimiter('   \n  ')).toBe(',');
  });

  it('falls back to a comma for a single column with no delimiter at all', () => {
    // One column is not evidence for any delimiter, and picking one on a tie
    // would be arbitrary.
    expect(sniffDelimiter('justonecolumn\nanotherline')).toBe(',');
  });
});

describe('parseDelimited — a quote inside a field', () => {
  /*
   * Twenty-nine rows of Safe QLD's own register carry one, and every single
   * one is an inch mark: "Approx 20"" Scissor required" is a note that
   * reaching that emergency light needs a twenty-foot scissor lift, and
   * "10"" -Switchboard in rear storage" is where the test switch is.
   *
   * A doubled quote inside a quoted field is one literal quote. Read any other
   * way the field runs on into the next one and the row shifts by a column —
   * silently, because what comes out is still a row of plausible strings. The
   * whole rule sits in one comparison and nothing exercised it.
   */
  it('reads a doubled quote as one, and keeps the field whole', () => {
    expect(parseDelimited(
      'Location,Note\n"10"" -Switchboard in rear storage","Approx 20"" Scissor required"',
    )).toEqual([
      ['Location', 'Note'],
      ['10" -Switchboard in rear storage', 'Approx 20" Scissor required'],
    ]);
  });

  it('reads a field that is nothing but an inch mark', () => {
    // The whole field is an opening quote, a doubled quote, and a close.
    expect(parseDelimited('Height,Kind\n"12""",Batten')).toEqual([
      ['Height', 'Kind'],
      ['12"', 'Batten'],
    ]);
  });

  it('does not let a quoted field swallow the delimiter that follows it', () => {
    // The failure this guards: the row shifts by a column and every value
    // after it lands under the wrong heading.
    const rows = parseDelimited('A,B,C\n"one"",",two,three');
    expect(rows[1]).toHaveLength(3);
    expect(rows[1]).toEqual(['one",', 'two', 'three']);
  });
});

describe('parseDelimited', () => {
  it('reads a plain table', () => {
    expect(parseDelimited('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('strips the byte order mark Excel writes', () => {
    /*
     * Without this the first header reads "﻿Asset Number" and matches
     * nothing, so the one column every import is keyed on silently goes
     * unmapped while every other column maps fine.
     */
    const rows = parseDelimited('﻿Asset Number,Type\n1001,Extinguisher');
    expect(rows[0]![0]).toBe('Asset Number');
  });

  it('keeps a comma that is inside a quoted field', () => {
    const rows = parseDelimited('ref,description\nD1,"Detector, level 3"');
    expect(rows[1]).toEqual(['D1', 'Detector, level 3']);
  });

  it('reads a doubled quote as one quote', () => {
    const rows = parseDelimited('ref,note\nD1,"He said ""closed"""');
    expect(rows[1]![1]).toBe('He said "closed"');
  });

  it('keeps a newline inside a quoted field rather than starting a row', () => {
    // A technician's note wraps. Splitting on that newline turns one asset into
    // two, and the second has no reference on it.
    const rows = parseDelimited('ref,note\nD1,"line one\nline two"\nD2,x');
    expect(rows).toHaveLength(3);
    expect(rows[1]![1]).toBe('line one\nline two');
    expect(rows[2]).toEqual(['D2', 'x']);
  });

  it('handles Windows line endings', () => {
    expect(parseDelimited('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('does not invent a row from a trailing newline', () => {
    expect(parseDelimited('a,b\n1,2\n')).toHaveLength(2);
  });

  it('drops a row that is entirely empty rather than importing a blank asset', () => {
    expect(parseDelimited('a,b\n1,2\n,,\n3,4')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
  });

  it('keeps a row where only one cell has anything in it', () => {
    // Sparse is not empty. A register row with only a reference is still a row
    // somebody has to be told about.
    expect(parseDelimited('a,b\n1,\n,2')).toEqual([['a', 'b'], ['1', ''], ['', '2']]);
  });

  it('honours a delimiter the caller already worked out', () => {
    // The import screen lets a person override the sniff. That override has to
    // win, or the correction does nothing.
    expect(parseDelimited('a;b\n1;2', ';')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseDelimited('a;b\n1;2', ',')).toEqual([['a;b'], ['1;2']]);
  });

  it('returns nothing for nothing', () => {
    expect(parseDelimited('')).toEqual([]);
    expect(parseDelimited('\n\n')).toEqual([]);
  });

  it('does not lose the last field when the file ends without a newline', () => {
    expect(parseDelimited('a,b\n1,2')[1]).toEqual(['1', '2']);
  });
});

describe('toCsv', () => {
  it('writes a plain table', () => {
    expect(toCsv([['a', 'b'], [1, 2]])).toBe('a,b\r\n1,2');
  });

  it('writes an empty cell for null and undefined rather than the word', () => {
    // "null" in a spreadsheet cell is a value somebody sorts and filters on.
    expect(toCsv([[null, undefined, '']])).toBe(',,');
  });

  it('quotes a field containing the delimiter', () => {
    expect(toCsv([['Detector, level 3']])).toBe('"Detector, level 3"');
  });

  it('doubles a quote inside a field', () => {
    expect(toCsv([['He said "closed"']])).toBe('"He said ""closed"""');
  });

  it('quotes a field containing a newline', () => {
    expect(toCsv([['line one\nline two']])).toBe('"line one\nline two"');
  });

  it('leaves an ordinary field unquoted, so the file stays readable', () => {
    expect(toCsv([['D1', 'Detector', '3']])).toBe('D1,Detector,3');
  });
});

describe('a file written here and read back here', () => {
  it('survives the round trip with its commas, quotes and newlines intact', () => {
    /*
     * The one that matters for a share pack: what this app writes, this app has
     * to be able to read. Every field below is one that has broken a CSV reader
     * somewhere.
     */
    const rows = [
      ['ref', 'description', 'note'],
      ['D1', 'Detector, level 3, east', 'He said "closed"'],
      ['D2', 'Sounder', 'line one\nline two'],
      ['D3', '', 'plain'],
    ];
    expect(parseDelimited(toCsv(rows))).toEqual(rows);
  });

  it('survives a field full of semicolons, which the sniff could mistake for the delimiter', () => {
    /*
     * The trap. toCsv always joins on commas and does not quote a semicolon,
     * so a register whose descriptions are semicolon-separated lists writes out
     * with more semicolons than commas — and the sniff, which rewards
     * consistency, could read the file back as semicolon-delimited and split
     * every description into pieces.
     */
    const rows = [
      ['ref', 'description'],
      ['D1', 'smoke; heat; multi'],
      ['D2', 'sounder; strobe; beacon'],
      ['D3', 'call point; break glass; cover'],
    ];
    expect(parseDelimited(toCsv(rows))).toEqual(rows);
  });
});
