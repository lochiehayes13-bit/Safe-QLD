import { planOutboundWork, outboundKey, keyIdentity, type CompletedRoutineRun, type OutboundDefect, type OutboundResult } from '@/domain/outboundWork';

const run = (over: Partial<CompletedRoutineRun> = {}): CompletedRoutineRun => ({
  runId: 'local-row-1', siteId: 'site-1', siteName: 'An Example Building', jobId: 'JOB-1',
  routineId: 'routine-annual-detection', routineLabel: 'Annual detection service',
  frequency: 'yearly', system: 'Detection', completedAt: '2026-07-03T04:30:00.000Z',
  technician: 'A Technician', ...over,
});
const pass = (n: string, over: Partial<OutboundResult> = {}): OutboundResult => ({
  assetId: `a-${n}`, assetNumber: n, name: 'Smoke detector', location: 'Level 1', outcome: 'pass', ...over,
});
const defect = (over: Partial<OutboundDefect> = {}): OutboundDefect => ({
  id: 'd-1', location: 'Level 3 east', description: 'Sprinkler control valve found closed.',
  severity: 'non-critical', status: 'open', raisedAt: '2026-07-03T04:30:00.000Z', ...over,
});

it('probe date-only raisedAt', () => {
  const p = planOutboundWork(run(), [pass('1')], [defect({ severity: 'critical', raisedAt: '2026-07-03' })]);
  console.log('=== CRITICAL NOTE ===\n' + p.items[0]!.payload.note);
});

it('probe money in not-tested reason', () => {
  const p = planOutboundWork(run(), [pass('1', { outcome: 'not-tested', notTestedReason: 'Quoted $450 to open the ceiling' })], []);
  console.log('warnings', p.warnings.map(w => w.code));
  console.log(p.items[0]!.payload.note);
});

it('probe identity collision across prefixes', () => {
  const k = outboundKey('DEF', ['x'], ['y']);
  console.log('key', k, 'identity', keyIdentity(k));
});

it('probe service note ordinary', () => {
  const p = planOutboundWork(run({ notes: 'All good.' }), [pass('1'), pass('2', { outcome: 'fail', notes: 'No response.' }), pass('3', { outcome: 'not-tested' })], [defect(), defect({ id: 'd2', severity: 'critical' })]);
  console.log('=== SERVICE NOTE ===\n' + p.items[1]!.payload.note);
  console.log('=== subject ===', p.items[1]!.payload.subject);
  console.log('summary', JSON.stringify(p.summary));
});
