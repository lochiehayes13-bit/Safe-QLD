import { PIN_KINDS, type PinKind } from './mapPins';

/**
 * Grid clustering for the service map.
 *
 * Three thousand dots at the zoom that shows the whole of south-east
 * Queensland are one orange smear over Brisbane, and drawing them costs a
 * phone a frame every time the map moves. So below a certain zoom the dots
 * are gathered into a grid of cells the size of a fingertip, and each cell
 * with more than one dot in it is drawn once, as a circle with a count. Zoom
 * in and the cells get smaller in the world, the dots spread across more of
 * them, and by zoom fourteen every dot stands on its own.
 *
 * A grid rather than a proper clustering algorithm because the grid is what
 * the page script can afford to mirror. The maths is here so it can be tested,
 * and copied into the Leaflet page in `mapHtml` line for line, which is why it
 * is written plainly: no classes, no closures a hand translation to ES5 would
 * trip over.
 */

/** Leaflet's tile size, which fixes the pixel scale of a zoom level. */
export const TILE_PX = 256;

/** The cell size in screen pixels. About a thumb: two dots closer than this cannot be told apart anyway. */
export const CLUSTER_CELL_PX = 56;

/** From this zoom up every dot is drawn on its own. Fourteen is the zoom at which a suburb fills the screen. */
export const CLUSTER_MAX_ZOOM = 14;

export interface WorldPoint {
  x: number;
  y: number;
}

/**
 * Where a coordinate falls in the world pixel grid at a zoom, in the Web
 * Mercator projection every slippy map uses. The latitude is clamped just
 * short of the poles, where the projection goes to infinity; nothing this
 * company services is there.
 */
export function worldPixel(latitude: number, longitude: number, zoom: number): WorldPoint {
  const scale = TILE_PX * Math.pow(2, zoom);
  const lat = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const sin = Math.sin((lat * Math.PI) / 180);
  const x = ((longitude + 180) / 360) * scale;
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return { x, y };
}

export interface ClusterInput {
  /** The caller's index for the point, handed back in `members`. */
  index: number;
  latitude: number;
  longitude: number;
  kind: PinKind;
}

export interface Cluster {
  latitude: number;
  longitude: number;
  count: number;
  /** The strongest kind among the members, so a cell with one job on now in it is orange. */
  kind: PinKind;
  members: number[];
}

export interface ClusterOptions {
  cellPx?: number;
  maxZoom?: number;
}

function strength(kind: PinKind): number {
  const i = PIN_KINDS.indexOf(kind);
  return i < 0 ? PIN_KINDS.length : i;
}

/**
 * The points gathered into grid cells at a zoom.
 *
 * At or above `maxZoom` every point comes back as its own cluster of one, so
 * a caller draws the result the same way at every zoom and only the counts
 * change. The centre of a cluster is the mean of its members, which for a
 * cell fifty pixels wide is never far from any of them.
 */
export function clusterPoints(
  points: readonly ClusterInput[],
  zoom: number,
  options: ClusterOptions = {},
): Cluster[] {
  const cellPx = options.cellPx ?? CLUSTER_CELL_PX;
  const maxZoom = options.maxZoom ?? CLUSTER_MAX_ZOOM;

  if (zoom >= maxZoom) {
    return points.map((p) => ({
      latitude: p.latitude,
      longitude: p.longitude,
      count: 1,
      kind: p.kind,
      members: [p.index],
    }));
  }

  const cells = new Map<string, { sumLat: number; sumLng: number; count: number; kind: PinKind; members: number[] }>();
  for (const p of points) {
    const px = worldPixel(p.latitude, p.longitude, zoom);
    const key = `${Math.floor(px.x / cellPx)}:${Math.floor(px.y / cellPx)}`;
    const cell = cells.get(key);
    if (cell) {
      cell.sumLat += p.latitude;
      cell.sumLng += p.longitude;
      cell.count += 1;
      cell.members.push(p.index);
      if (strength(p.kind) < strength(cell.kind)) cell.kind = p.kind;
    } else {
      cells.set(key, { sumLat: p.latitude, sumLng: p.longitude, count: 1, kind: p.kind, members: [p.index] });
    }
  }

  const out: Cluster[] = [];
  for (const cell of cells.values()) {
    out.push({
      latitude: cell.sumLat / cell.count,
      longitude: cell.sumLng / cell.count,
      count: cell.count,
      kind: cell.kind,
      members: cell.members,
    });
  }
  return out;
}

/**
 * The zoom to jump to when a cluster is tapped: far enough in that the cell
 * breaks up, without leaping straight to street level from the whole state.
 */
export function expandZoom(zoom: number, maxZoom: number = CLUSTER_MAX_ZOOM): number {
  return Math.min(maxZoom, Math.floor(zoom) + 2);
}
