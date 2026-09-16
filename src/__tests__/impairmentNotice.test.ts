import { impairmentDuration, impairmentNoticeHtml, noticeUndertakings } from '@/export/impairmentNotice';
import type { ImpairmentRecord } from '@/db/opsRepo';
import type { Site } from '@/domain/types';

/**
 * The notice a building gets when its fire system is off.
 *
 * The screen tracked all of this and could produce none of it: a tick beside
 * "responsible person notified" is a record that a conversation happened, and
 * six months later that is not an answer to what the building was told.
 *
 * Three things have to be true of the printed page, and each of them fails in
 * a way that still looks like a correct document.
 *
 * A box that is not ticked has to print. A form that shows only its yeses
 * hides exactly the fact a responsible person most needs — that nobody rang
 * the monitoring provider.
 *
 * An impairment that is still running must not print a restoration. A blank
 * that quietly fills itself in is a notice nobody checks.
 *
 * And it has to say it is not the statutory form, for the same reason the
 * critical defect notice does.
 */

const site: Site = {
  id: 's1',
  name: 'An Example Building',
  address: '12 Example Street',
  suburb: 'Ipswich',
  state: 'QLD',
  postcode: '4305',
} as Site;

const rec = (over: Partial<ImpairmentRecord> = {}): ImpairmentRecord => ({
  id: 'i1',
  siteId: 's1',
  system: 'Sprinkler system',
  scope: 'East riser isolated at the floor control valve',
  reason: 'Head replacement on level 3',
  startedAt: '2026-07-03T04:30:00.000Z',
  responsibleNotified: true,
  responsibleName: 'The building manager',
  brigadeNotified: false,
  monitoringNotified: false,
  fireWatchInPlace: true,
  signagePlaced: true,
  isolatedAssets: [],
  ...over,
});

const html = (r: ImpairmentRecord, at = '2026-07-03T07:30:00.000Z') =>
  impairmentNoticeHtml({ record: r, site, companyName: 'A Fire Company', generatedAt: at });

describe('how long it has been out', () => {
  it('says it the way a person would', () => {
    expect(impairmentDuration(3 * 3_600_000 + 12 * 60_000)).toBe('3 hours 12 minutes');
    expect(impairmentDuration(45 * 60_000)).toBe('45 minutes');
    expect(impairmentDuration(3_600_000)).toBe('1 hour');
  });

  it('drops the minutes once it has been days', () => {
    // Nobody cares, and printing them claims a precision the start time
    // does not have.
    expect(impairmentDuration(2 * 86_400_000 + 3 * 3_600_000 + 12 * 60_000)).toBe('2 days 3 hours');
  });

  it('does not produce an empty string or a negative', () => {
    expect(impairmentDuration(0)).toBe('Less than a minute');
    expect(impairmentDuration(-5000)).toBe('Less than a minute');
    expect(impairmentDuration(30_000)).toBe('Less than a minute');
    expect(impairmentDuration(Number.NaN)).toBe('Less than a minute');
  });
});

describe('what has been done', () => {
  it('lists what was not done as well as what was', () => {
    const said = noticeUndertakings(rec());
    expect(said.find((u) => u.label.startsWith('Monitoring'))?.done).toBe(false);
    expect(said.find((u) => u.label.startsWith('Responsible'))?.done).toBe(true);
    expect(said).toHaveLength(5);
  });

  it('prints the noes on the page, not only the yeses', () => {
    const out = html(rec());
    // Both words have to be reachable, and the un-ticked ones marked as such.
    expect(out).toMatch(/Monitoring provider notified<\/td><td class="no">No/);
    expect(out).toMatch(/Responsible person notified<\/td><td class="yes">Yes/);
  });
});

describe('the notice', () => {
  it('does not fill in a restoration that has not happened', () => {
    const out = html(rec());
    expect(out).toContain('Still out of service');
    expect(out).toContain('Fire Safety Impairment Notice');
  });

  it('turns into a closure once the system is back', () => {
    const out = html(rec({ restoredAt: '2026-07-03T07:30:00.000Z' }));
    expect(out).toContain('Impairment Closed');
    expect(out).toContain('returned to service');
    expect(out).not.toContain('Still out of service');
    expect(out).toContain('3 hours');
  });

  it('says plainly that it is not the approved form', () => {
    expect(html(rec())).toContain('not an approved statutory form');
  });

  it('says what is off and how long it has been off', () => {
    const out = html(rec());
    expect(out).toContain('Sprinkler system');
    expect(out).toContain('East riser isolated at the floor control valve');
    expect(out).toContain('Running for 3 hours');
  });

  it('asks for interim measures when none were recorded', () => {
    // The blank is the finding. A notice that says nothing about interim
    // measures reads as though none were needed.
    expect(html(rec())).toContain('No alternative measures have been recorded');
    expect(html(rec({ alternativeMeasures: 'Hourly fire watch' }))).toContain('Hourly fire watch');
  });

  it('does not ask for interim measures on a closed impairment', () => {
    const out = html(rec({ restoredAt: '2026-07-03T07:30:00.000Z' }));
    expect(out).not.toContain('No alternative measures have been recorded');
  });

  it('lists the equipment that was isolated', () => {
    const out = html(rec({ isolatedAssets: ['FCV-3 east', 'Flow switch 3E'] }));
    expect(out).toContain('FCV-3 east');
    expect(out).toContain('Flow switch 3E');
  });

  it('escapes what a site name can actually contain', () => {
    const out = impairmentNoticeHtml({
      record: rec({ system: 'Sprinkler & hydrant <combined>' }),
      site: { ...site, name: 'Smith & Sons "Depot"' } as Site,
      companyName: 'A Fire Company',
      generatedAt: '2026-07-03T07:30:00.000Z',
    });
    expect(out).toContain('Smith &amp; Sons &quot;Depot&quot;');
    expect(out).toContain('Sprinkler &amp; hydrant &lt;combined&gt;');
    expect(out).not.toContain('<combined>');
  });

  it('keeps a multi-line scope readable rather than running it together', () => {
    const out = html(rec({ scope: 'East riser isolated\nLevel 3 flow switch strapped' }));
    expect(out).toContain('East riser isolated<br/>Level 3 flow switch strapped');
  });
});
