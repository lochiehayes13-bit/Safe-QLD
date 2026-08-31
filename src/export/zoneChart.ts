import { columnise, suggestedColumns, type ZoneChart } from '@/domain/zoneChart';
import { formatAuDate } from './sheets';
import type { Panel, Site } from '@/domain/types';

/**
 * The zone chart, as something to print and put on the panel door.
 *
 * Generated from the configuration imported off that panel, so it cannot
 * disagree with it — which is the whole reason to produce one rather than
 * transcribe one. The monthly routine checks that the chart present is legible
 * and matches the installed zones; when it does not, this is the fix, printed
 * on site.
 *
 * Deliberately plain. This is read at a panel, sometimes at night, sometimes by
 * someone who is not a fire technician. Large zone numbers, high contrast, no
 * decoration.
 */

function esc(s: string | undefined | null): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface ZoneChartInput {
  site: Site;
  panel: Panel;
  chart: ZoneChart;
  companyName: string;
  generatedAt: string;
  /** Landscape suits a wide chart on a panel door; portrait suits a tall one. */
  orientation?: 'portrait' | 'landscape';
}

export function zoneChartHtml(input: ZoneChartInput): string {
  const { site, panel, chart } = input;
  const orientation = input.orientation ?? (chart.rows.length > 40 ? 'landscape' : 'portrait');
  const columns = suggestedColumns(chart.rows.length);
  const grouped = columnise(chart.rows, columns);
  const address = [site.address, site.suburb, site.state, site.postcode].filter(Boolean).join(' ');

  // Type scales down as the panel gets bigger, because the alternative is a
  // second page and a chart in two halves is a chart nobody trusts.
  const fontSize = chart.rows.length > 200 ? 8 : chart.rows.length > 100 ? 9.5 : 11;
  const numberWidth = chart.rows.length > 200 ? 30 : 38;

  const column = (rows: typeof chart.rows) => `<table>
${rows.map((r) => `  <tr${r.unused ? ' class="unused"' : ''}>
    <td class="n">${r.number}</td>
    <td>
      <span class="zt">${esc(r.text) || '<span class="missing">No zone text programmed</span>'}</span>
      ${r.text2 ? `<span class="zt2">${esc(r.text2)}</span>` : ''}
      ${r.summary ? `<span class="dev">${esc(r.summary)}</span>` : ''}
    </td>
  </tr>`).join('\n')}
</table>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  @page { size: A4 ${orientation}; margin: 10mm; }
  body { font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; color: #000;
         font-size: ${fontSize}px; line-height: 1.3; margin: 0; }
  .bar { height: 6px; background: #C00000; margin-bottom: 10px; }
  h1 { font-size: 22px; margin: 0; letter-spacing: -0.3px; }
  .head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 4px; }
  .prem { font-size: 13px; font-weight: 700; }
  .addr { color: #333; font-size: 10px; }
  .meta { text-align: right; color: #333; font-size: 9px; line-height: 1.5; }
  .cols { display: flex; gap: 10px; align-items: flex-start; }
  .cols > div { flex: 1; }
  table { width: 100%; border-collapse: collapse; }
  td { border-bottom: 1px solid #BBB; padding: 3px 4px; vertical-align: top; }
  td.n { width: ${numberWidth}px; text-align: right; font-weight: 700; font-size: ${fontSize + 3}px;
         font-variant-numeric: tabular-nums; padding-right: 7px; }
  .zt { display: block; font-weight: 600; }
  .zt2 { display: block; color: #333; }
  .dev { display: block; color: #666; font-size: ${fontSize - 1.5}px; }
  .missing { color: #C00000; font-weight: 700; font-style: italic; }
  tr.unused td { color: #999; }
  tr.unused td.n { font-weight: 400; }
  .warn { border: 2px solid #C00000; background: #FDF2F2; padding: 6px 9px; margin: 8px 0; font-size: 9.5px; }
  .foot { margin-top: 10px; padding-top: 6px; border-top: 1px solid #BBB; color: #555; font-size: 8px;
          display: flex; justify-content: space-between; }
  </style></head><body>
<div class="bar"></div>
<div class="head">
  <div>
    <h1>Zone Chart</h1>
    <div class="prem">${esc(site.name)}</div>
    ${address ? `<div class="addr">${esc(address)}</div>` : ''}
  </div>
  <div class="meta">
    <div><strong>${esc(panel.name)}</strong>${panel.model ? ` — ${esc(panel.model)}` : ''}</div>
    <div>${chart.totalZones} zones · ${chart.totalDevices} devices</div>
    <div>Generated ${esc(formatAuDate(input.generatedAt.slice(0, 10)))}</div>
  </div>
</div>

${chart.untexted.length ? `<div class="warn">
  <strong>${chart.untexted.length} zone${chart.untexted.length === 1 ? '' : 's'} in this panel carr${chart.untexted.length === 1 ? 'ies' : 'y'} devices but no zone text:</strong>
  ${chart.untexted.join(', ')}. A zone nobody can locate from the panel is the defect this chart exists to prevent —
  programme the text and reprint.
</div>` : ''}

${chart.orphanedPoints ? `<div class="warn">
  <strong>${chart.orphanedPoints} device${chart.orphanedPoints === 1 ? '' : 's'} report${chart.orphanedPoints === 1 ? 's' : ''} to a zone that is not in the panel's zone table.</strong>
  They are not on this chart because the panel does not describe where they are.
</div>` : ''}

<div class="cols">
${grouped.map((rows) => `  <div>${column(rows)}</div>`).join('\n')}
</div>

<div class="foot">
  <span>${esc(input.companyName)} — generated from the configuration imported from this panel</span>
  <span>Verify against the panel before it is relied on</span>
</div>
</body></html>`;
}
