/**
 * Every timesheet carries its owner's name.
 *
 * Accounts asked for it after a week arrived without one: "just in case we
 * ever have an audit". A week was named only if the name was set in Settings
 * before the week was started, and Export and the page went out without
 * checking. Now every draft on the phone takes the name, and nothing leaves
 * without one. A week already sent stays as accounts received it, and the
 * vehicle is only ever filled when a week is started.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createTimesheet, getTimesheet, nameUnnamedDrafts, ownerOfThisPhone, saveTimesheet,
} from '@/db/timesheetRepo';
import { replaceEmployees } from '@/db/employeeRepo';
import { NO_NAME_ON_SHEET, timesheetOwner } from '@/domain/timesheetOwner';
import { timesheetNotReady } from '@/domain/timesheetEmail';
import { timesheetDocumentHtml } from '@/export/timesheetDocument';
import { openMigrated, type NodeSqliteDb } from './support/nodeSqlite';
import { codeOf } from './support/sourceCode';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));

let db: NodeSqliteDb;
beforeEach(() => { db = openMigrated(); });
afterEach(async () => { await db.closeAsync(); });

const PREFS = { technicianName: 'Sam Tech', vehicleRego: 'ABC123', simproEmployeeId: '' };

describe('whose weeks these are', () => {
  it('is the name in Settings, else the person picked in Simpro', () => {
    expect(timesheetOwner(PREFS).name).toBe('Sam Tech');
    expect(timesheetOwner({ ...PREFS, technicianName: '  ' }, { name: 'Dana Whitlock' }).name).toBe('Dana Whitlock');
    expect(timesheetOwner({ ...PREFS, technicianName: '' }, null).name).toBe('');
  });

  it('reads the Simpro pick off the last sync when Settings has no name', async () => {
    await replaceEmployees([{ id: '7', name: 'Dana Whitlock' }]);
    expect(await ownerOfThisPhone({ technicianName: '', vehicleRego: 'XYZ9', simproEmployeeId: '7' }))
      .toEqual({ name: 'Dana Whitlock', vehicleRego: 'XYZ9' });
  });

  it('does not name a week after somebody archived in Simpro', async () => {
    await replaceEmployees([{ id: '7', name: 'Dana Whitlock', archived: true }]);
    expect((await ownerOfThisPhone({ technicianName: '', vehicleRego: '', simproEmployeeId: '7' })).name).toBe('');
  });
});

describe('naming the drafts already on the phone', () => {
  const week = (over: Parameters<typeof createTimesheet>[0]) => createTimesheet(over);

  it('names an unnamed draft, and nothing else about it changes', async () => {
    const blank = await week({ weekStarting: '2026-10-14', kilometerReading: '120450' });
    expect(await nameUnnamedDrafts('Sam Tech')).toBe(1);
    expect(await getTimesheet(blank.id)).toMatchObject({
      employeeName: 'Sam Tech', vehicleRego: '', kilometerReading: '120450', status: 'draft',
    });
  });

  it('leaves a typed name, and a week already sent, exactly as they are', async () => {
    const typed = await week({ weekStarting: '2026-10-07', employeeName: 'Sam T' });
    const sent = await week({ weekStarting: '2026-09-30' });
    await saveTimesheet({ ...sent, status: 'submitted' });
    expect(await nameUnnamedDrafts('Sam Tech')).toBe(0);
    expect((await getTimesheet(typed.id))!.employeeName).toBe('Sam T');
    expect((await getTimesheet(sent.id))!.employeeName).toBe('');
  });

  it('touches only the week asked for when given one', async () => {
    const a = await week({ weekStarting: '2026-10-14' });
    const b = await week({ weekStarting: '2026-10-07' });
    expect(await nameUnnamedDrafts('Sam Tech', a.id)).toBe(1);
    expect((await getTimesheet(a.id))!.employeeName).toBe('Sam Tech');
    expect((await getTimesheet(b.id))!.employeeName).toBe('');
  });

  it('does nothing with no name to give, and nothing the second time', async () => {
    await week({ weekStarting: '2026-10-14' });
    expect(await nameUnnamedDrafts('  ')).toBe(0);
    expect(await nameUnnamedDrafts('Sam Tech')).toBe(1);
    expect(await nameUnnamedDrafts('Sam Tech')).toBe(0);
  });
});

describe('nothing leaves the phone without a name', () => {
  const screen = codeOf(readFileSync(join(__dirname, '..', '..', 'app', 'timesheet', '[id].tsx'), 'utf8'));
  const list = codeOf(readFileSync(join(__dirname, '..', '..', 'app', 'work', 'timesheets.tsx'), 'utf8'));

  it('refuses the email in the same words as Export and the page', async () => {
    const blank = await createTimesheet({ weekStarting: '2026-10-14' });
    expect(timesheetNotReady(blank)).toBe(NO_NAME_ON_SHEET);
    for (const fn of ['const exportSheet = async () => {', 'const sharePage = async () => {']) {
      const at = screen.indexOf(fn);
      expect({ fn, found: at >= 0 }).toEqual({ fn, found: true });
      expect(screen.slice(at, at + 200)).toContain("if (!sheet.employeeName.trim()) { showAlert('Add your name', NO_NAME_ON_SHEET); return; }");
    }
  });

  it('names a draft as it opens, and every draft as the list shows, without blocking either', () => {
    expect(screen).toContain('await nameUnnamedDrafts(owner.name, found.id).catch(() => 0);');
    expect(list).toContain('if (owner?.name) await nameUnnamedDrafts(owner.name).catch(() => 0);');
    // The whole-row save is not how the name goes on.
    expect(list).not.toMatch(/withOwner|for \(const \[i, s\] of named/);
  });

  it('starts a new week, or a copied one, with the owner’s name and vehicle', () => {
    expect((list.match(/employeeName: owner\.name/g) ?? []).length).toBe(2);
    expect((list.match(/vehicleRego: owner\.vehicleRego/g) ?? []).length).toBe(2);
  });

  it('prints the name at the sign-off on the page, not only at the top', async () => {
    const named = await createTimesheet({ weekStarting: '2026-10-14', employeeName: 'Sam Tech' });
    const html = timesheetDocumentHtml(named);
    const sign = html.slice(html.indexOf('<div class="sign">'));
    expect(sign).toContain('<b>Sam Tech</b>');
  });
});
