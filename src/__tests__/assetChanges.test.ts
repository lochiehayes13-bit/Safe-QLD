import {
  UNDO_WINDOW_MS, assetChangeKey, buildArchive, buildCreate, buildDelete, buildUpdate, changedFields,
  describeAssetChange, describeChangeState, diffFields, isAssetChangeKind, isBeforeWindow, undoDeadline, undoMsLeft,
  updateHasContent,
} from '@/domain/assetChanges';

/**
 * The register change as a value: its key, its window, its words, and the
 * diff that keeps a correction to what changed. Pure, so every rule is
 * checked here and the send in outboundAssets.test only checks the wire.
 */

const NOW = '2026-09-09T01:00:00.000Z';
const T = { now: NOW, changeNo: 1 };

describe('building a change', () => {
  it('keys on the kind, the asset and the change number, so an edit after an edit is new', () => {
    const first = buildUpdate({ assetId: 'a1', assetExternalId: '900', fields: [{ name: 'Location', value: 'L1' }], label: 'x' }, T);
    const second = buildUpdate({ assetId: 'a1', assetExternalId: '900', fields: [{ name: 'Location', value: 'L1' }], label: 'x' }, { ...T, changeNo: 2 });
    expect(first.contentKey).toBe('asset-update|a1|1');
    expect(second.contentKey).toBe('asset-update|a1|2');
    expect(assetChangeKey('asset-delete', 'a1', 3)).toBe('asset-delete|a1|3');
    // The same tap twice is the same key.
    expect(buildUpdate({ assetId: 'a1', assetExternalId: '900', fields: [], label: 'x' }, T).contentKey).toBe(first.contentKey);
  });

  it('opens a thirty-second window from now', () => {
    const built = buildArchive({ assetId: 'a1', assetExternalId: '900', previousStatus: 'in-service', label: 'x' }, T);
    expect(UNDO_WINDOW_MS).toBe(30_000);
    expect(built.payload.notBefore).toBe('2026-09-09T01:00:30.000Z');
    expect(undoDeadline(NOW, 5_000)).toBe('2026-09-09T01:00:05.000Z');
  });

  it('drops blank fields from a create and trims the tag', () => {
    const built = buildCreate({
      assetId: 'a1', siteExternalId: '55', assetTypeExternalId: '7', assetTypeName: 'Extinguishers',
      fields: [{ id: 1, name: 'Location', value: ' L1 ' }, { id: 2, name: 'Size', value: '   ' }],
      startDate: '2026-09-01', tag: ' E-12 ', label: 'Extinguisher E-12',
    }, T);
    expect(built.kind).toBe('asset-create');
    expect(built.payload.fields).toEqual([{ id: 1, name: 'Location', value: ' L1 ' }]);
    expect(built.payload.tag).toBe('E-12');
    expect(built.payload.startDate).toBe('2026-09-01');
    expect(buildCreate({ assetId: 'a1', siteExternalId: '55', assetTypeExternalId: '7', fields: [], tag: '  ', label: 'x' }, T).payload.tag).toBeUndefined();
  });

  it('carries the status to put back on an archive or a delete', () => {
    expect(buildArchive({ assetId: 'a1', assetExternalId: '900', previousStatus: 'in-service', label: 'x' }, T).payload).toMatchObject({ kind: 'asset-archive', previousStatus: 'in-service' });
    expect(buildDelete({ assetId: 'a1', assetExternalId: '900', previousStatus: 'isolated', label: 'x' }, T).payload).toMatchObject({ kind: 'asset-delete', previousStatus: 'isolated' });
  });

  it('knows its four kinds and nothing else', () => {
    expect(['asset-create', 'asset-update', 'asset-archive', 'asset-delete'].every(isAssetChangeKind)).toBe(true);
    expect(isAssetChangeKind('asset-test')).toBe(false);
    expect(isAssetChangeKind('timesheet-block')).toBe(false);
  });
});

describe('the window', () => {
  it('holds a change until its moment and not after', () => {
    expect(isBeforeWindow('2026-09-09T01:00:29.999Z', '2026-09-09T01:00:30.000Z')).toBe(true);
    expect(isBeforeWindow('2026-09-09T01:00:30.000Z', '2026-09-09T01:00:30.000Z')).toBe(false);
    expect(isBeforeWindow('2026-09-09T02:00:00.000Z', '2026-09-09T01:00:30.000Z')).toBe(false);
  });

  it('treats a missing or unreadable moment as passed rather than as never', () => {
    expect(isBeforeWindow(NOW, undefined)).toBe(false);
    expect(isBeforeWindow(NOW, 'soon')).toBe(false);
  });

  it('counts down and stops at zero', () => {
    expect(undoMsLeft('2026-09-09T01:00:10.000Z', '2026-09-09T01:00:30.000Z')).toBe(20_000);
    expect(undoMsLeft('2026-09-09T01:00:31.000Z', '2026-09-09T01:00:30.000Z')).toBe(0);
    expect(undoMsLeft(NOW, undefined)).toBe(0);
  });
});

describe('what changed', () => {
  it('names each column and each attribute on its own', () => {
    const before = { name: 'Ext', level: '1', room: 'Kitchen', serial: 'S1', attributes: { 'Extinguisher Type': 'ABE', size: '4.5' } };
    const after = { name: 'Ext', level: '2', room: 'Kitchen', serial: 'S1', attributes: { 'Extinguisher Type': 'CO2', size: '4.5', tag: 'E-1' } };
    expect(changedFields(before, after)).toEqual(['level', 'attributes.Extinguisher Type', 'attributes.tag']);
  });

  it('reads blank, absent and whitespace as the same value', () => {
    expect(changedFields({ level: '' }, { level: undefined })).toEqual([]);
    expect(changedFields({ notes: ' a ' }, { notes: 'a' })).toEqual([]);
    expect(changedFields({ attributes: { x: '' } }, { attributes: {} })).toEqual([]);
    expect(changedFields({ attributes: { x: 4 } }, { attributes: { x: '4' } })).toEqual([]);
  });

  it('keeps a PATCH to the office fields that differ, and clears one that went blank', () => {
    const before = [{ name: 'Location', value: 'L1' }, { name: 'Asset #', value: 'E-1' }, { name: 'Size', value: '4.5' }];
    const after = [{ name: 'Location', value: 'L2 ' }, { name: 'Asset #', value: 'E-1' }, { name: 'Colour', value: 'Red' }];
    expect(diffFields(before, after)).toEqual([
      { name: 'Location', value: 'L2' },
      { name: 'Colour', value: 'Red' },
      { name: 'Size', value: '' },
    ]);
    expect(diffFields(before, before)).toEqual([]);
  });

  it('says whether an update has anything for the office', () => {
    expect(updateHasContent({ fields: [] })).toBe(false);
    expect(updateHasContent({ fields: [{ name: 'Location', value: 'x' }] })).toBe(true);
    expect(updateHasContent({ fields: [], startDate: '2026-09-01' })).toBe(true);
  });
});

describe('the words', () => {
  it('says what each kind does, with the asset and its fields', () => {
    expect(describeAssetChange('asset-create', { label: 'Extinguisher E-12', assetTypeName: 'Fire Extinguishers' })).toBe('New asset in Simpro: Extinguisher E-12 (Fire Extinguishers)');
    expect(describeAssetChange('asset-update', { label: 'Extinguisher E-12', fields: [{ name: 'Location', value: 'L2' }], startDate: '2026-09-01' })).toBe('Asset corrected in Simpro: Extinguisher E-12 — Location, Start date');
    expect(describeAssetChange('asset-archive', { label: 'Hose reel 3' })).toBe('Asset archived in Simpro: Hose reel 3');
    expect(describeAssetChange('asset-delete', { label: 'Hose reel 3' })).toBe('Asset deleted from Simpro: Hose reel 3');
  });

  it('copes with a payload that could not be read', () => {
    expect(describeAssetChange('asset-archive', null)).toBe('Asset archived in Simpro: an asset');
    expect(describeAssetChange('something', { label: '' })).toBe('Register change: an asset');
  });

  it('has a sentence for each state a change can be in', () => {
    expect(describeChangeState('undoable')).toMatch(/take it back/);
    expect(describeChangeState('queued')).toMatch(/next sync/);
    expect(describeChangeState('sent')).toBe('Sent to the office');
    expect(describeChangeState('failed', 'HTTP 422')).toBe('Refused by Simpro: HTTP 422');
    expect(describeChangeState('unknown')).toMatch(/Waiting to send/);
    expect(describeChangeState('taken-back')).toMatch(/before it went/);
    expect(describeChangeState('forgotten')).toMatch(/the office does not have it/);
    expect(describeChangeState('forgotten', 'HTTP 502')).toMatch(/HTTP 502/);
  });
});
