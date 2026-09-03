/**
 * The web app went out and every screen looked broken: the timesheet's job
 * picker said nothing matched, the baseline record refused for want of a
 * building, purchases and the map were empty. Nothing was broken — the browser
 * was simply a device nobody had connected to the office, and not one screen
 * said so. "Add a site first", on a device one sync away from three thousand
 * of them, sends a person the wrong way.
 */
import { needsSiteState, officeEmptyState } from '@/domain/deviceData';

const fresh = { held: 0, connected: false, everSynced: false };
const connected = { held: 0, connected: true, everSynced: false };
const synced = { held: 0, connected: true, everSynced: true };

describe('a list of the office own records', () => {
  it('on a device nobody has connected, says that, and points at Settings', () => {
    const words = officeEmptyState(fresh, 'jobs');
    expect(words.title).toMatch(/not connected/i);
    expect(words.body).toMatch(/Simpro/);
    expect(words.action).toEqual({ label: 'Connect to the office', route: '/settings' });
  });

  it('never tells somebody to add one by hand when the office has thousands', () => {
    expect(officeEmptyState(fresh, 'sites').body).not.toMatch(/add (a|one)/i);
  });

  it('once connected but never pulled, says to sync rather than to connect again', () => {
    const words = officeEmptyState(connected, 'sites');
    expect(words.title).toMatch(/nothing has come down/i);
    expect(words.body).toMatch(/sync/i);
  });

  it('after a sync that brought none, stops blaming the connection', () => {
    expect(officeEmptyState(synced, 'quotes').title).toBe('No quotes yet');
  });

  it('with rows held, a blank list is a search that matched nothing', () => {
    expect(officeEmptyState({ ...synced, held: 4562 }, 'jobs').title).toBe('Nothing matched');
  });
});

describe('something that belongs to a building', () => {
  it('on an unconnected device, offers the connection first and adding by hand second', () => {
    const words = needsSiteState(fresh, 'Baseline data');
    expect(words.body).toMatch(/connect it to the office/i);
    expect(words.body).toMatch(/add one by hand/i);
    expect(words.action?.route).toBe('/settings');
  });

  it('on a connected device, adding one by hand is the sensible offer', () => {
    expect(needsSiteState(synced, 'A report').action).toEqual({ label: 'Add a site', route: '/site/new' });
  });

  it('with sites held, it is a choice, not an absence', () => {
    expect(needsSiteState({ ...synced, held: 12 }, 'Baseline data').title).toBe('Pick a site');
  });
});
