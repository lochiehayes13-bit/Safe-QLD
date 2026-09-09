import type { QueuedItem, SendDeps, SendMoreOutcome } from './outboundKinds';

/**
 * Sending changes to the office's asset register: an asset created on site,
 * one corrected, one removed.
 *
 * Its own module because the register is the one thing the office schedules
 * twelve and a half thousand jobs from, and a change to it deserves its own
 * rules — a confirmation before it queues, a moment to take it back, and a
 * row that says exactly what it did. ./outboundMore hands any kind it does
 * not know to this module before giving up on it.
 *
 * Not yet wired to the build: each kind lands here as it is built.
 */
export async function sendAssetChange(item: QueuedItem, deps: SendDeps): Promise<SendMoreOutcome> {
  void item;
  void deps;
  return { status: 'not-mine' };
}
