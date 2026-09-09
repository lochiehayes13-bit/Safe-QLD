import type { QueuedItem, SendDeps, SendMoreOutcome } from './outboundKinds';

/**
 * Sending schedule changes a technician makes on the phone: booking
 * themselves onto a job, moving a block, taking one off.
 *
 * The clock-on's hours go up as schedule blocks too, and live in
 * ./outboundMore; this module is for the blocks a person places on the
 * calendar ahead of time rather than the ones the clock records as they
 * happen. ./outboundMore hands any kind it does not know here before giving
 * up on it.
 *
 * Not yet wired to the build: each kind lands here as it is built.
 */
export async function sendScheduleChange(item: QueuedItem, deps: SendDeps): Promise<SendMoreOutcome> {
  void item;
  void deps;
  return { status: 'not-mine' };
}
