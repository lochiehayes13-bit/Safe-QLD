import { STALE_AFTER_MS, assessQueue, stuckWords, type QueueItem } from '@/domain/stuckWork';

/**
 * The strip that says work has not reached the office.
 *
 * Everything this app sends goes through a queue, and until now the queue only
 * spoke on a screen nobody opens. The failure it has to catch is the quiet one:
 * a technician writes up a defect in a basement, the app says it is on the way,
 * and it is still on the phone a week later because the send was refused.
 *
 * Two ways this goes wrong, and they pull against each other. Say nothing and
 * the work is lost. Say something every time an item sits in the queue for an
 * hour and a technician in a carpark learns to ignore the strip, which is the
 * same as saying nothing but harder to fix.
 */

const NOW = '2026-07-10T02:00:00.000Z';
const ago = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();

const item = (over: Partial<QueueItem> = {}): QueueItem => ({
  createdAt: ago(60_000),
  status: 'pending',
  ...over,
});

describe('reading the queue', () => {
  it('says nothing about a queue that is simply working', () => {
    const s = assessQueue([item(), item(), item({ status: 'sending' })], NOW);
    expect(s.clear).toBe(true);
    expect(stuckWords(s)).toBeUndefined();
  });

  it('says nothing about an empty queue', () => {
    expect(assessQueue([], NOW).clear).toBe(true);
  });

  it('counts a refusal straight away, however new it is', () => {
    // A refusal is not going to fix itself by waiting.
    const s = assessQueue([item({ status: 'failed', createdAt: ago(1000) })], NOW);
    expect(s.failed).toBe(1);
    expect(s.clear).toBe(false);
  });

  it('counts a send that got no reply separately from a refusal', () => {
    // They need different things from a person: one is fixed, the other is
    // checked in Simpro and then either retried or let go.
    const s = assessQueue([item({ status: 'unknown' })], NOW);
    expect(s.unknown).toBe(1);
    expect(s.failed).toBe(0);
    expect(stuckWords(s)?.body).toContain('may be in Simpro twice or not at all');
  });

  it('leaves a pending item alone until it has been a day', () => {
    const nearly = assessQueue([item({ createdAt: ago(STALE_AFTER_MS - 60_000) })], NOW);
    expect(nearly.waiting).toBe(0);
    const over = assessQueue([item({ createdAt: ago(STALE_AFTER_MS + 60_000) })], NOW);
    expect(over.waiting).toBe(1);
  });

  it('treats a date it cannot read as stuck rather than ignoring it', () => {
    // A row the app cannot date is a row it cannot vouch for.
    const s = assessQueue([item({ createdAt: 'not a date' })], NOW);
    expect(s.waiting).toBe(1);
  });

  it('counts a photograph that will not upload once, not twice', () => {
    /*
     * attachmentQueueSummary reads sync_queue with kind = 'attachment', and
     * queueHealth reads every non-sent row of the same table — so an
     * attachment arrives here through both doors. Adding the summary on top
     * of the rows reported every failed photograph as two, which is the kind
     * of number that makes a technician stop believing the strip.
     */
    const s = assessQueue(
      [
        item({ status: 'failed', kind: 'attachment' }),
        item({ status: 'failed', kind: 'attachment' }),
        item({ status: 'failed', kind: 'attachment' }),
        item({ status: 'unknown', kind: 'attachment' }),
      ],
      NOW,
    );
    expect(s.failed).toBe(3);
    expect(s.unknown).toBe(1);
    // Pending attachments are not stuck: they are a phone waiting for signal.
    expect(s.waiting).toBe(0);
  });

  it('dates an attachment like anything else, because it is a queue row like anything else', () => {
    // The summary gave counts and no dates, so a stuck photograph could never
    // be the oldest thing. Reading the rows fixes that for free.
    const s = assessQueue([item({ status: 'failed', kind: 'attachment', createdAt: ago(3 * STALE_AFTER_MS) })], NOW);
    expect(s.oldestAt).toBe(ago(3 * STALE_AFTER_MS));
  });

  it('says how many of the stuck things are photographs', () => {
    const s = assessQueue(
      [item({ status: 'failed', kind: 'attachment' }), item({ status: 'failed', kind: 'defect' })],
      NOW,
    );
    expect(s.photos).toBe(1);
    expect(stuckWords(s)?.body).toContain('photograph');
  });

  it('names the oldest thing that is stuck, not the oldest thing in the queue', () => {
    const s = assessQueue(
      [
        item({ createdAt: ago(9 * STALE_AFTER_MS) }),                 // pending and stale
        item({ status: 'failed', createdAt: ago(2 * STALE_AFTER_MS) }),
        item({ createdAt: ago(1000) }),                                // fine, and newest
      ],
      NOW,
    );
    expect(s.oldestAt).toBe(ago(9 * STALE_AFTER_MS));
  });
});

describe('what it says', () => {
  it('leads with the refusal when there is one, because that is the one nobody is fixing', () => {
    const w = stuckWords(assessQueue(
      [item({ status: 'failed' }), item({ createdAt: ago(2 * STALE_AFTER_MS) })],
      NOW,
    ));
    expect(w?.tone).toBe('fail');
    expect(w?.title).toContain('has not reached the office');
    expect(w?.body).toContain('It is not in Simpro');
  });

  it('is a warning, not a failure, when things are only waiting', () => {
    const w = stuckWords(assessQueue([item({ createdAt: ago(3 * STALE_AFTER_MS) })], NOW));
    expect(w?.tone).toBe('warn');
    expect(w?.body).toContain('has not been able to reach the office');
  });

  it('counts in words a person uses, and gets the singular right', () => {
    const one = stuckWords(assessQueue([item({ status: 'failed' })], NOW));
    expect(one?.body).toContain('1 thing the office refused');
    const two = stuckWords(assessQueue([item({ status: 'failed' }), item({ status: 'failed' })], NOW));
    expect(two?.body).toContain('2 things the office refused');
  });

  it('says when the oldest has been sitting, in Queensland time', () => {
    const w = stuckWords(assessQueue([item({ status: 'failed', createdAt: '2026-07-07T23:30:00.000Z' })], NOW));
    // 09:30 on the 8th here, not 23:30 on the 7th.
    expect(w?.body).toContain('8/07/2026');
  });
});
