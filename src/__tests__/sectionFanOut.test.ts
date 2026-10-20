import { SimproMirror, SIMPRO_PATHS, ITEM_KINDS, SECTION_READ_FAN_OUT } from '@/simpro/mirrorResources';
import type { SimproClient } from '@/simpro/client';

/**
 * The section tree is read wide, not deep, and the answers still come back
 * in the build's order.
 *
 * A job's material lines sit four levels down — sections, then cost centres,
 * then one endpoint per item family — and the traversal used to `await` every
 * one of those in series. A three-section job with two cost centres each is
 * 34 requests, which at the 200-400ms a round trip to the build costs was
 * about ten seconds for one job, sixty times a sync run. The reads are now
 * overlapped: the sections list alone first, then every cost-centre read at
 * once, then the five item families under a cost centre at once.
 *
 * Two things can go wrong with that and neither shows up as a crash, so they
 * are what these tests are for. The first is ordering: if the results were
 * collected as each answer landed rather than by the input order, a job's
 * materials list would reshuffle between syncs on nothing but which request
 * happened to be quick, and a technician reading a parts list would have no
 * idea why it moved. The second is the socket count: bounding each level
 * separately multiplies out, so a forty-section job would put hundreds of
 * pending reads on a phone that is often on one bar of mobile data.
 *
 * The client here never settles a read on its own — the test decides when
 * each one answers — which is the only way to prove reads overlap rather than
 * merely that they all eventually happened. Under the old serial code the
 * second request would not even have been made until the first answered, so
 * every "all of these were asked for before any answered" assertion below
 * fails against it.
 */

interface Pending {
  path: string;
  resolve: (rows: unknown[]) => void;
  reject: (e: unknown) => void;
}

/** A client that records every read and answers none until told to. */
function controlledClient() {
  const pending: Pending[] = [];
  const asked: string[] = [];
  const client = {
    listAll: (path: string) => new Promise<unknown[]>((resolve, reject) => {
      asked.push(path);
      pending.push({ path, resolve, reject });
    }),
  } as unknown as SimproClient;

  /** Answers the one outstanding read for `path`, or fails loudly if it was never asked for. */
  const answer = async (path: string, rows: unknown[]): Promise<void> => {
    const i = pending.findIndex((p) => p.path === path);
    if (i < 0) throw new Error(`Nothing asked for ${path}. Asked so far: ${asked.join(', ')}`);
    pending.splice(i, 1)[0]!.resolve(rows);
    await settled();
  };

  const refuse = async (path: string, e: unknown): Promise<void> => {
    const i = pending.findIndex((p) => p.path === path);
    if (i < 0) throw new Error(`Nothing asked for ${path}. Asked so far: ${asked.join(', ')}`);
    pending.splice(i, 1)[0]!.reject(e);
    await settled();
  };

  /** Answers every read outstanding right now, and any the answers set off. */
  const answerRest = async (rows: unknown[] = []): Promise<void> => {
    for (let guard = 0; guard < 200 && pending.length; guard++) {
      const batch = pending.splice(0, pending.length);
      for (const p of batch) p.resolve(rows);
      await settled();
    }
  };

  return { client, pending, asked, answer, refuse, answerRest };
}

/** Lets every already-queued promise continuation run before the test looks again. */
const settled = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise<void>((r) => { setImmediate(r); });
};

const JOB = '38412';
const section = (id: number, name: string, order: number) =>
  ({ ID: id, Name: name, DisplayOrder: order });
const costCenter = (id: number, name: string, order = 1) => ({ ID: id, Name: name, DisplayOrder: order });
const line = (description: string) => ({ ID: 1, Description: description, Total: { Qty: 1 } });

describe('the item-family reads under one cost centre', () => {
  it('are all asked for before any of them answers, and land in ITEM_KINDS order', async () => {
    const { client, asked, answer, pending } = controlledClient();
    const read = new SimproMirror(client).jobSections(JOB);
    await settled();

    // Nothing but the sections list can go first: no other path exists until
    // the section ids are known.
    expect(asked).toEqual([SIMPRO_PATHS.jobSections(JOB)]);

    await answer(SIMPRO_PATHS.jobSections(JOB), [section(7, 'Level 1 detection', 1)]);
    expect(asked).toEqual([SIMPRO_PATHS.jobSections(JOB), SIMPRO_PATHS.jobCostCenters(JOB, '7')]);

    await answer(SIMPRO_PATHS.jobCostCenters(JOB, '7'), [costCenter(11, 'Detection service')]);

    // The whole point: five families outstanding at once, not one.
    const itemPaths = ITEM_KINDS.map((k) => SIMPRO_PATHS.jobItems(JOB, '7', '11', k));
    expect(pending.map((p) => p.path).sort()).toEqual([...itemPaths].sort());

    // Answered in reverse, so completion order and ITEM_KINDS order disagree.
    for (const kind of [...ITEM_KINDS].reverse()) {
      await answer(SIMPRO_PATHS.jobItems(JOB, '7', '11', kind), [line(`a ${kind} line`)]);
    }

    const sections = await read;
    expect(sections).toHaveLength(1);
    expect(sections[0]!.costCenters[0]!.items.map((i) => i.kind)).toEqual(ITEM_KINDS);
    expect(sections[0]!.costCenters[0]!.items.map((i) => i.description))
      .toEqual(ITEM_KINDS.map((k) => `a ${k} line`));
  });

  it('keeps every line of a family together and in the order the build listed them', async () => {
    const { client, answer, answerRest } = controlledClient();
    const read = new SimproMirror(client).jobSections(JOB);
    await settled();
    await answer(SIMPRO_PATHS.jobSections(JOB), [section(7, 'Level 1 detection', 1)]);
    await answer(SIMPRO_PATHS.jobCostCenters(JOB, '7'), [costCenter(11, 'Detection service')]);
    await answer(SIMPRO_PATHS.jobItems(JOB, '7', '11', 'catalog'), [line('smoke detector'), line('base')]);
    await answerRest();

    const items = (await read)[0]!.costCenters[0]!.items;
    expect(items.map((i) => i.description)).toEqual(['smoke detector', 'base']);
  });
});

describe('the cost-centre reads across sections', () => {
  it('all go at once and the sections still come back in displayOrder', async () => {
    const { client, answer, pending, answerRest } = controlledClient();
    const read = new SimproMirror(client).jobSections(JOB);
    await settled();

    // Listed out of displayOrder on purpose, as the build is free to do.
    await answer(SIMPRO_PATHS.jobSections(JOB), [
      section(7, 'Level 2 sprinkler', 3),
      section(8, 'Level 1 detection', 1),
      section(9, 'Pump room', 2),
    ]);
    expect(pending.map((p) => p.path).sort()).toEqual(
      ['7', '8', '9'].map((s) => SIMPRO_PATHS.jobCostCenters(JOB, s)).sort(),
    );

    // The last section answers first, so completion order is not input order.
    await answer(SIMPRO_PATHS.jobCostCenters(JOB, '9'), [costCenter(31, 'Pump service')]);
    await answer(SIMPRO_PATHS.jobCostCenters(JOB, '8'), [costCenter(21, 'Detection service')]);
    await answer(SIMPRO_PATHS.jobCostCenters(JOB, '7'), [costCenter(11, 'Sprinkler service')]);
    await answerRest();

    const sections = await read;
    expect(sections.map((s) => s.name)).toEqual(['Level 1 detection', 'Pump room', 'Level 2 sprinkler']);
    expect(sections.map((s) => s.costCenters[0]!.name))
      .toEqual(['Detection service', 'Pump service', 'Sprinkler service']);
  });

  it('keeps a section\'s cost centres in the order the build listed them', async () => {
    const { client, answer, answerRest } = controlledClient();
    const read = new SimproMirror(client).jobSections(JOB);
    await settled();
    await answer(SIMPRO_PATHS.jobSections(JOB), [section(7, 'Level 1 detection', 1)]);
    await answer(SIMPRO_PATHS.jobCostCenters(JOB, '7'), [
      costCenter(11, 'Detection service'),
      costCenter(12, 'Emergency lighting'),
      costCenter(13, 'Extinguishers'),
    ]);
    await answerRest();

    expect((await read)[0]!.costCenters.map((c) => c.name))
      .toEqual(['Detection service', 'Emergency lighting', 'Extinguishers']);
  });

  it('skips a section or a cost centre the build returned with no id', async () => {
    const { client, answer, asked, answerRest } = controlledClient();
    const read = new SimproMirror(client).jobSections(JOB);
    await settled();
    await answer(SIMPRO_PATHS.jobSections(JOB), [
      { Name: 'No id at all', DisplayOrder: 1 },
      section(7, 'Level 1 detection', 2),
    ]);
    // One cost-centre read, not two: the idless section is dropped before the
    // fan-out rather than asked about.
    expect(asked.filter((p) => p.includes('/costCenters'))).toHaveLength(1);

    await answer(SIMPRO_PATHS.jobCostCenters(JOB, '7'), [{ Name: 'Nameless, idless' }, costCenter(11, 'Detection service')]);
    await answerRest();

    const sections = await read;
    expect(sections.map((s) => s.name)).toEqual(['Level 1 detection']);
    expect(sections[0]!.costCenters.map((c) => c.name)).toEqual(['Detection service']);
  });
});

describe('the request count and the fan-out ceiling', () => {
  it('asks for exactly 1 + S + 5*S*C paths, so the overlap costs no extra reads', async () => {
    const { client, answer, asked, answerRest } = controlledClient();
    const read = new SimproMirror(client).jobSections(JOB);
    await settled();
    await answer(SIMPRO_PATHS.jobSections(JOB), [section(7, 'Level 1 detection', 1), section(8, 'Pump room', 2)]);
    await answer(SIMPRO_PATHS.jobCostCenters(JOB, '7'), [costCenter(11, 'Detection service'), costCenter(12, 'Lighting')]);
    await answer(SIMPRO_PATHS.jobCostCenters(JOB, '8'), [costCenter(21, 'Pump service')]);
    await answerRest();
    await read;

    // 2 sections, 3 cost centres between them: 1 + 2 + 5*3.
    expect(asked).toHaveLength(1 + 2 + 5 * 3);
    expect(new Set(asked).size).toBe(asked.length);
  });

  it('never holds more than SECTION_READ_FAN_OUT reads open, however wide the job is', async () => {
    const { client, answer, pending, asked, answerRest } = controlledClient();
    const read = new SimproMirror(client).jobSections(JOB);
    await settled();

    const many = Array.from({ length: 24 }, (_, i) => section(100 + i, `Section ${i + 1}`, i + 1));
    await answer(SIMPRO_PATHS.jobSections(JOB), many);

    // Twenty-four sections could be twenty-four reads in flight; the gate
    // holds it to the ceiling and releases a slot as each answer lands.
    expect(pending).toHaveLength(SECTION_READ_FAN_OUT);
    expect(SECTION_READ_FAN_OUT).toBeLessThan(many.length);

    await answer(pending[0]!.path, [costCenter(11, 'Detection service')]);
    expect(pending).toHaveLength(SECTION_READ_FAN_OUT);

    await answerRest([costCenter(11, 'Detection service')]);
    const sections = await read;

    // Every section was still read, and the ceiling did not cost a request.
    expect(sections).toHaveLength(many.length);
    expect(asked).toHaveLength(1 + many.length + 5 * many.length);
    expect(sections.map((s) => s.name)).toEqual(many.map((s) => s.Name));
  });
});

describe('a read that fails', () => {
  it('fails the whole section list in the server\'s own words, as the serial code did', async () => {
    const { client, answer, refuse, answerRest } = controlledClient();
    const read = new SimproMirror(client).jobSections(JOB);
    const seen = read.then(() => 'resolved', (e: unknown) => (e instanceof Error ? e.message : String(e)));
    await settled();
    await answer(SIMPRO_PATHS.jobSections(JOB), [section(7, 'Level 1 detection', 1)]);
    await answer(SIMPRO_PATHS.jobCostCenters(JOB, '7'), [costCenter(11, 'Detection service')]);
    await refuse(
      SIMPRO_PATHS.jobItems(JOB, '7', '11', 'prebuild'),
      new Error('This Simpro key is not permitted to read the prebuilds under a cost centre.'),
    );
    await answerRest();

    // readOneJobDetail wraps this call in its `attempt` helper, so a refusal
    // here costs the sections and nothing else — the job itself is still
    // written and the run says which family was missed. Swallowing it here
    // instead would write a job with no materials as if that were the truth.
    expect(await seen).toBe('This Simpro key is not permitted to read the prebuilds under a cost centre.');
  });

  it('releases its fan-out slot, so the sections behind it are still read', async () => {
    const { client, answer, refuse, asked, answerRest, pending } = controlledClient();
    const read = new SimproMirror(client).jobSections(JOB);
    const settledRead = read.catch(() => 'failed');
    await settled();

    const many = Array.from({ length: 12 }, (_, i) => section(200 + i, `Section ${i + 1}`, i + 1));
    await answer(SIMPRO_PATHS.jobSections(JOB), many);
    expect(pending).toHaveLength(SECTION_READ_FAN_OUT);

    await refuse(pending[0]!.path, new Error('Simpro returned HTTP 500 for a cost centre list.'));
    // The failure did not strand its slot: a queued section moved into it.
    expect(pending).toHaveLength(SECTION_READ_FAN_OUT);

    await answerRest([costCenter(11, 'Detection service')]);
    expect(await settledRead).toBe('failed');
    // Every section was still asked about rather than abandoned mid-list.
    expect(asked.filter((p) => p.endsWith('/costCenters/'))).toHaveLength(many.length);
  });
});

describe('quoteSections', () => {
  it('overlaps the same way, on the quote paths', async () => {
    const { client, answer, pending, answerRest } = controlledClient();
    const read = new SimproMirror(client).quoteSections('9104');
    await settled();
    await answer(SIMPRO_PATHS.quoteSections('9104'), [section(7, 'Stage 1 install', 1)]);
    await answer(SIMPRO_PATHS.quoteCostCenters('9104', '7'), [costCenter(11, 'Detection install')]);

    expect(pending.map((p) => p.path).sort())
      .toEqual(ITEM_KINDS.map((k) => SIMPRO_PATHS.quoteItems('9104', '7', '11', k)).sort());

    await answerRest([line('smoke detector')]);
    const sections = await read;
    expect(sections[0]!.costCenters[0]!.items.map((i) => i.kind)).toEqual(ITEM_KINDS);
  });
});
