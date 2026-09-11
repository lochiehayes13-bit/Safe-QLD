/*
 * The staff list stands in for the database and for Simpro.
 *
 * Both are real on a phone and neither exists in a Node test run, and the
 * thing under test is which of the two is asked and what happens when the
 * second one says no — so they are the two things worth faking precisely.
 */
jest.mock('@/db/employeeRepo', () => {
  const rows: { id: string; name: string; email?: string; position?: string; archived: boolean; syncedAt: string }[] = [];
  return {
    listEmployees: async (options: { includeArchived?: boolean } = {}) => (
      options.includeArchived ? [...rows] : rows.filter((r) => !r.archived)
    ),
    replaceEmployees: async (people: { id: string; name: string; email?: string; position?: string; archived?: boolean }[]) => {
      rows.splice(0, rows.length, ...people.map((p) => ({ ...p, archived: p.archived === true, syncedAt: '2026-09-11T00:00:00.000Z' })));
      return rows.length;
    },
  };
});
jest.mock('@/simpro/client', () => ({ SimproClient: jest.fn() }));
jest.mock('@/simpro/resources', () => ({ SimproResources: jest.fn() }));
jest.mock('@/simpro/autoSync', () => ({ runAutoSync: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));

import { listEmployees, replaceEmployees } from '@/db/employeeRepo';
import { SimproResources } from '@/simpro/resources';
import { DEFAULT_PREFS } from '@/app-prefs';
import { simproConfigFromPrefs } from '@/simpro/config';
import { ensureEmployees, loadStaffList } from '@/simpro/signInFlow';

/**
 * The staff list on a phone that was installed ten minutes ago.
 *
 * It is the way in on this office's build, so it is the one list that cannot
 * be left to the sync. The screen used to read whatever the database held and
 * say, to an empty result, that the list would come down with the next sync —
 * which on a new phone is six minutes away and is not an answer to the
 * question "who are you". So the read is made here, and the two ways it ends
 * badly are told apart: Simpro refusing, which is worth another go, and an
 * office with nobody on its employee list, which is not.
 */

const CONFIG = simproConfigFromPrefs(DEFAULT_PREFS);
const asMock = SimproResources as unknown as jest.Mock;

/** What Simpro answers the one request this makes. */
const officeAnswers = (answer: () => Promise<{ id: string; name: string; archived?: boolean }[]>) => {
  asMock.mockImplementation(() => ({ employees: answer }));
};

beforeEach(async () => {
  asMock.mockReset();
  await replaceEmployees([]);
});

describe('reading the staff list', () => {
  it('takes what the phone already holds without asking the office', async () => {
    await replaceEmployees([{ id: '7', name: 'Dana Whitlock' }]);
    officeAnswers(async () => {
      throw new Error('the office must not be asked when the phone already holds the list');
    });

    const list = await loadStaffList(CONFIG);

    expect(list.people.map((p) => p.name)).toEqual(['Dana Whitlock']);
    expect(list.fromOffice).toBe(false);
    expect(asMock).not.toHaveBeenCalled();
  });

  it('reads it from the office on a phone that holds none, and keeps it there', async () => {
    officeAnswers(async () => [{ id: '7', name: 'Dana Whitlock' }, { id: '9', name: 'Kel Marsden' }]);

    const first = await loadStaffList(CONFIG);
    expect(first.fromOffice).toBe(true);
    expect(first.people.map((p) => p.id)).toEqual(['7', '9']);

    // Kept, so the second visit to the screen is not a second request.
    expect((await listEmployees({ includeArchived: true })).length).toBe(2);
    expect((await loadStaffList(CONFIG)).fromOffice).toBe(false);
    expect(asMock).toHaveBeenCalledTimes(1);
  });

  it('brings down the archived as well, so a phone set to one still shows a name', async () => {
    officeAnswers(async () => [{ id: '7', name: 'Dana Whitlock', archived: true }]);

    expect((await loadStaffList(CONFIG)).people[0]).toMatchObject({ id: '7', archived: true });
  });

  it('throws what Simpro said, because a screen with nothing to show has to say why', async () => {
    officeAnswers(async () => { throw new Error('Simpro refused the read (HTTP 403): Forbidden'); });

    await expect(loadStaffList(CONFIG)).rejects.toThrow('HTTP 403');
  });

  it('comes back empty rather than throwing where the office really has nobody', async () => {
    // A different sentence on the screen: trying again will not change it.
    officeAnswers(async () => []);

    const list = await loadStaffList(CONFIG);
    expect(list.people).toEqual([]);
    expect(list.fromOffice).toBe(true);
  });
});

describe('the sign-in\'s own use of it', () => {
  it('counts what is held and swallows a failed read, because a sign-in still worked', async () => {
    officeAnswers(async () => { throw new Error('Simpro could not be reached'); });
    expect(await ensureEmployees(CONFIG)).toBe(0);

    officeAnswers(async () => [{ id: '7', name: 'Dana Whitlock' }]);
    expect(await ensureEmployees(CONFIG)).toBe(1);
  });
});
