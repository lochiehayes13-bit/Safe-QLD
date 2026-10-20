import {
  CLUSTER_CELL_PX, CLUSTER_MAX_ZOOM, TILE_PX, clusterPoints, expandZoom, worldPixel, type ClusterInput,
} from '@/domain/mapCluster';
import { mapHtml } from '@/domain/mapPins';

/**
 * The grid the map gathers its dots into.
 *
 * Two copies of this maths exist — the module, and the page script that
 * mirrors it in ES5 — and the last test runs both on the same points, because
 * a cluster the page draws differently from the one the module would have
 * drawn is a bug nobody sees until a dot is in the wrong cell.
 */

// Two sites a street apart in a made-up suburb, and one across the bay.
const CLOSE_A: ClusterInput = { index: 0, latitude: -27.6000, longitude: 152.9000, kind: 'site' };
const CLOSE_B: ClusterInput = { index: 1, latitude: -27.6009, longitude: 152.9010, kind: 'open' };
const FAR: ClusterInput = { index: 2, latitude: -27.4000, longitude: 153.2000, kind: 'upcoming' };

describe('the projection', () => {
  it('puts the origin in the middle of the world at zoom zero', () => {
    expect(worldPixel(0, 0, 0)).toEqual({ x: TILE_PX / 2, y: TILE_PX / 2 });
  });

  it('doubles with every zoom level', () => {
    const z1 = worldPixel(-27.5, 153, 1);
    const z2 = worldPixel(-27.5, 153, 2);
    expect(z2.x).toBeCloseTo(z1.x * 2, 6);
    expect(z2.y).toBeCloseTo(z1.y * 2, 6);
  });

  it('is south-positive in y, the way a screen is', () => {
    expect(worldPixel(-27.5, 153, 5).y).toBeGreaterThan(worldPixel(27.5, 153, 5).y);
  });

  it('does not go to infinity at the poles', () => {
    expect(Number.isFinite(worldPixel(90, 0, 3).y)).toBe(true);
    expect(Number.isFinite(worldPixel(-90, 0, 3).y)).toBe(true);
  });
});

describe('clustering', () => {
  it('gathers neighbours into one cell at a wide zoom and leaves the distant one alone', () => {
    const clusters = clusterPoints([CLOSE_A, CLOSE_B, FAR], 9);
    expect(clusters).toHaveLength(2);
    const pair = clusters.find((c) => c.count === 2)!;
    expect(pair.members.sort()).toEqual([0, 1]);
    expect(clusters.find((c) => c.count === 1)?.members).toEqual([2]);
  });

  it('draws every dot on its own at street zoom', () => {
    const clusters = clusterPoints([CLOSE_A, CLOSE_B, FAR], CLUSTER_MAX_ZOOM);
    expect(clusters).toHaveLength(3);
    expect(clusters.every((c) => c.count === 1)).toBe(true);
    expect(clusters.map((c) => c.members[0])).toEqual([0, 1, 2]);
  });

  it('colours a cell by the strongest thing in it', () => {
    const pair = clusterPoints([CLOSE_A, CLOSE_B], 9).find((c) => c.count === 2)!;
    expect(pair.kind).toBe('open');
    // And the other way round, so it is not just "the last one wins".
    const reversed = clusterPoints([CLOSE_B, CLOSE_A], 9).find((c) => c.count === 2)!;
    expect(reversed.kind).toBe('open');
  });

  it('sits a cell at the mean of its members', () => {
    const pair = clusterPoints([CLOSE_A, CLOSE_B], 9).find((c) => c.count === 2)!;
    expect(pair.latitude).toBeCloseTo((CLOSE_A.latitude + CLOSE_B.latitude) / 2, 9);
    expect(pair.longitude).toBeCloseTo((CLOSE_A.longitude + CLOSE_B.longitude) / 2, 9);
  });

  it('is empty for no points', () => {
    expect(clusterPoints([], 9)).toEqual([]);
    expect(clusterPoints([], 16)).toEqual([]);
  });

  it('honours a smaller cell', () => {
    // A one-pixel cell at zoom 9 separates the pair; the default does not.
    expect(clusterPoints([CLOSE_A, CLOSE_B], 9, { cellPx: 1 })).toHaveLength(2);
    expect(clusterPoints([CLOSE_A, CLOSE_B], 9, { cellPx: CLUSTER_CELL_PX })).toHaveLength(1);
  });

  it('jumps two zooms on a tap, and never past the zoom where dots stand alone', () => {
    expect(expandZoom(9)).toBe(11);
    expect(expandZoom(12.6)).toBe(14);
    expect(expandZoom(13)).toBe(CLUSTER_MAX_ZOOM);
    expect(expandZoom(18)).toBe(CLUSTER_MAX_ZOOM);
  });
});

describe('the page’s copy of the grid', () => {
  const page = mapHtml([], { centre: { latitude: -27.47, longitude: 153.02 }, zoom: 9, dark: true });

  /** The grid functions lifted out of the page script and run here as plain JavaScript. */
  function pageGrid(): { clusterPoints: typeof clusterPoints; worldPixel: typeof worldPixel } {
    const start = page.indexOf('// --- The grid');
    const end = page.indexOf('// --- Drawing');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const src = page.slice(start, end);
    const factory = new Function(
      'ORDER', 'CELL_PX', 'MAX_ZOOM', 'TILE_PX',
      `function strength(kind) { var i = ORDER.indexOf(kind); return i < 0 ? ORDER.length : i; }
       ${src}
       return { clusterPoints: clusterPoints, worldPixel: worldPixel };`,
    ) as (...args: unknown[]) => { clusterPoints: typeof clusterPoints; worldPixel: typeof worldPixel };
    return factory(['open', 'upcoming', 'recent', 'quote', 'site'], CLUSTER_CELL_PX, CLUSTER_MAX_ZOOM, TILE_PX);
  }

  it('uses the same cell size and the same cut-off zoom', () => {
    expect(page).toContain(`var CELL_PX = ${CLUSTER_CELL_PX};`);
    expect(page).toContain(`var MAX_ZOOM = ${CLUSTER_MAX_ZOOM};`);
    expect(page).toContain(`var TILE_PX = ${TILE_PX};`);
  });

  it('projects and clusters exactly as the module does', () => {
    const grid = pageGrid();
    const points = [CLOSE_A, CLOSE_B, FAR];
    for (const zoom of [5, 9, 12, 14, 16]) {
      const ours = clusterPoints(points, zoom);
      const theirs = grid.clusterPoints(points, zoom);
      expect({ zoom, clusters: theirs }).toEqual({ zoom, clusters: ours });
    }
    expect(grid.worldPixel(-27.5, 153, 11)).toEqual(worldPixel(-27.5, 153, 11));
  });
});
