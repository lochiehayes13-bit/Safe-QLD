/**
 * The sync, run against the real office system.
 *
 * Not part of the suite: it needs credentials and a network, and it reads the
 * company's own data. It exists because every other test mocks the build, and
 * a mock cannot tell you that a column set is refused, that a filter is
 * ignored, or that four and a half thousand jobs take six minutes on a phone.
 *
 *   SAFEQLD_LIVE=/path/to/creds.json npx jest src/__tests__/liveSync.manual.ts
 *
 * The credentials file is never in this repository, and nothing it reads is
 * written back into one.
 */
import { readFileSync } from 'fs';

jest.mock('@/db/index', () => jest.requireActual('./support/nodeSqlite'));
// The pull never touches these, but the module graph does: they are the
// phone's file system and image tools, which do not load under Node.
jest.mock('@/simpro/attachmentFiles', () => ({
  readAttachmentBytes: jest.fn(), shrinkIfNeeded: jest.fn(), photosWithSizes: jest.fn(async () => []),
}));
jest.mock('expo-file-system', () => ({ File: class {}, Directory: class {}, Paths: {} }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
jest.setTimeout(15 * 60 * 1000);

const CREDS = process.env.SAFEQLD_LIVE;
const maybe = CREDS ? describe : describe.skip;

maybe('the sync against the real build', () => {
  it('pulls the office onto a clean device and says what it did', async () => {
    const creds = JSON.parse(readFileSync(CREDS!, 'utf8')) as {
      client_id: string; client_secret: string; base: string;
    };
    const { openMigrated, attachDb } = await import('./support/nodeSqlite');
    const { pullFromSimpro } = await import('@/simpro/sync');
    const { SimproClient } = await import('@/simpro/client');
    attachDb(openMigrated());
    await SimproClient.storeSecret(creds.client_secret);

    const started = Date.now();
    const stages: string[] = [];
    const result = await pullFromSimpro(
      {
        buildDomain: creds.base.replace(/^https?:\/\//, ''),
        companyId: '0',
        clientId: creds.client_id,
      },
      (p) => stages.push(`${p.done}/${p.total} ${p.stage}`),
    );
    const seconds = Math.round((Date.now() - started) / 100) / 10;

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ seconds, result, stages }, null, 1));
    expect(result.errors ?? []).toEqual([]);
  });
});
