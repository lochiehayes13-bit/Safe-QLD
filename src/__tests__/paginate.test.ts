/**
 * Where a rasterised page may end.
 *
 * The documents say where a page may not break — every table row, every boxed
 * warning, a part's heading and the note under it — and the print engine
 * honours it. The web build rasterises instead of printing, so the same rules
 * are applied to the measured boxes here, with rectangles standing in for the
 * browser.
 */
import { pageCuts, type PageFlow } from '@/export/paginate';

const flow = (over: Partial<PageFlow>): PageFlow => ({
  docHeight: 2589, pageHeight: 1032, unbreakable: [], keepWithNext: [], ...over,
});

describe('a document with nothing to keep whole', () => {
  it('cuts at page height until the document ends', () => {
    expect(pageCuts(flow({}))).toEqual([{ top: 0, bottom: 1032 }, { top: 1032, bottom: 2064 }, { top: 2064, bottom: 2589 }]);
  });

  it('is one page where it fits', () => {
    expect(pageCuts(flow({ docHeight: 500 }))).toEqual([{ top: 0, bottom: 500 }]);
  });

  it('is no pages at all for an empty document', () => {
    expect(pageCuts(flow({ docHeight: 0 }))).toEqual([]);
  });
});

describe('a row a cut would pass through', () => {
  it('moves the cut up to the row’s top, so the row starts the next page whole', () => {
    // A row from 1000 to 1060 straddles the 1032 cut.
    const pages = pageCuts(flow({ unbreakable: [{ top: 1000, bottom: 1060 }] }));
    expect(pages[0]).toEqual({ top: 0, bottom: 1000 });
    expect(pages[1]!.top).toBe(1000);
  });

  it('keeps walking up when the new cut lands inside something else', () => {
    const pages = pageCuts(flow({ unbreakable: [{ top: 1000, bottom: 1060 }, { top: 980, bottom: 1001 }] }));
    expect(pages[0]!.bottom).toBe(980);
  });

  it('leaves a box that merely touches the cut alone', () => {
    // Shares the edge; nothing is cut through.
    const pages = pageCuts(flow({ unbreakable: [{ top: 1000, bottom: 1032 }, { top: 1032, bottom: 1060 }] }));
    expect(pages[0]!.bottom).toBe(1032);
  });

  it('cuts through a box taller than a page rather than emitting a blank sheet', () => {
    const pages = pageCuts(flow({ docHeight: 3000, unbreakable: [{ top: 10, bottom: 1500 }] }));
    expect(pages[0]).toEqual({ top: 0, bottom: 1032 });
  });

  it('cuts through a box that would leave the page nearly empty', () => {
    // A box from 30px down to past the page: keeping it whole would mean a
    // page holding thirty pixels and the box on the next, cut anyway.
    const pages = pageCuts(flow({ docHeight: 3000, unbreakable: [{ top: 30, bottom: 1100 }] }));
    expect(pages[0]!.bottom).toBe(1032);
  });

  it('but keeps one whole where the page would still be mostly full', () => {
    const pages = pageCuts(flow({ docHeight: 3000, unbreakable: [{ top: 900, bottom: 1100 }] }));
    expect(pages[0]!.bottom).toBe(900);
  });
});

describe('a heading that must keep what follows it', () => {
  it('moves to the next page with its table rather than ending a page alone', () => {
    // The band sits at 990–1020 and its table starts at 1020. A cut at 1032
    // would strand "Part E" at the foot of the page with its rows overleaf.
    const pages = pageCuts(flow({
      unbreakable: [{ top: 1020, bottom: 1050 }],
      keepWithNext: [{ top: 990, nextTop: 1020 }],
    }));
    expect(pages[0]!.bottom).toBe(990);
  });

  it('and takes its note with it', () => {
    // Band 960–990, note 990–1020 keeps the table at 1020–1050. The cut walks
    // up through the row, then the note, then the band.
    const pages = pageCuts(flow({
      unbreakable: [{ top: 1020, bottom: 1050 }],
      keepWithNext: [{ top: 960, nextTop: 990 }, { top: 990, nextTop: 1020 }],
    }));
    expect(pages[0]!.bottom).toBe(960);
  });
});

describe('a forced break', () => {
  it('starts a new page there whatever else would have fitted', () => {
    const pages = pageCuts(flow({ breakBefore: [600] }));
    expect(pages[0]).toEqual({ top: 0, bottom: 600 });
    expect(pages[1]!.top).toBe(600);
  });

  it('wins over an unbreakable box that spans it, because the author asked for the page', () => {
    const pages = pageCuts(flow({ breakBefore: [600], unbreakable: [{ top: 590, bottom: 620 }] }));
    expect(pages[0]!.bottom).toBe(600);
  });

  it('is ignored at the very top and past the end', () => {
    expect(pageCuts(flow({ docHeight: 500, breakBefore: [0, 500, 900] }))).toEqual([{ top: 0, bottom: 500 }]);
  });
});

describe('the measurements the form actually produces', () => {
  it('reproduces the print engine’s own breaks on the filled Form 72', () => {
    /*
     * Measured off the rendered form: the Part D grid's first row sits at
     * 1027–1048 and the print engine ended page one at 1027. The raster must
     * agree, or the two builds hand the office different documents.
     */
    const rows = [[1027, 1048], [1048, 1069], [1069, 1090]].map(([top, bottom]) => ({ top: top!, bottom: bottom! }));
    const pages = pageCuts(flow({ unbreakable: rows }));
    expect(pages[0]!.bottom).toBe(1027);
  });

  it('never produces a page of zero height or loses the tail of the document', () => {
    const unbreakable = Array.from({ length: 120 }, (_, i) => ({ top: i * 21, bottom: i * 21 + 21 }));
    const pages = pageCuts(flow({ docHeight: 2520, unbreakable }));
    expect(pages.every((p) => p.bottom > p.top)).toBe(true);
    expect(pages[0]!.top).toBe(0);
    expect(pages[pages.length - 1]!.bottom).toBe(2520);
    for (let i = 1; i < pages.length; i++) expect(pages[i]!.top).toBe(pages[i - 1]!.bottom);
  });
});
