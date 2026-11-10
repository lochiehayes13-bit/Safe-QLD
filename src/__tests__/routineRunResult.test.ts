import { readFileSync } from 'fs';
import { join } from 'path';
import { assetResult, decidingLast, recordedMessage, type RecordedRun } from '@/domain/routineRunResult';
import { codeOf } from './support/sourceCode';

/**
 * One asset, many checks, one result.
 *
 * The run screen wrote the asset's last result once per check, so a fail on
 * the first check and a pass on the second saved the asset as Pass, and N/A
 * saved as Pass too.
 */

describe('assetResult', () => {
  it('a fail followed by a pass is a fail', () => {
    expect(assetResult(['fail', 'pass'])).toBe('fail');
    expect(assetResult(['pass', 'fail', 'pass'])).toBe('fail');
  });

  it('ignores N/A', () => {
    expect(assetResult(['na', 'pass'])).toBe('pass');
    expect(assetResult(['pass', 'na', 'fail'])).toBe('fail');
  });

  it('all N/A is not a pass, and leaves the asset as it was', () => {
    expect(assetResult(['na'])).toBeUndefined();
    expect(assetResult(['na', 'na'])).toBeUndefined();
  });

  it('a check not tested is its own gap, not a result', () => {
    expect(assetResult(['not-tested'])).toBeUndefined();
    expect(assetResult(['not-tested', 'pass'])).toBe('pass');
    expect(assetResult([undefined, 'pass'])).toBe('pass');
    expect(assetResult([])).toBeUndefined();
  });
});

describe('decidingLast', () => {
  it('writes the failure last, so the send to the office reads the asset as failed', () => {
    const checks = [
      { id: 'a', verdict: 'fail' as const },
      { id: 'b', verdict: 'pass' as const },
      { id: 'c', verdict: 'na' as const },
      { id: 'd', verdict: 'not-tested' as const },
      { id: 'e', verdict: 'pass' as const },
    ];
    expect(decidingLast(checks).map((c) => c.id)).toEqual(['d', 'c', 'b', 'e', 'a']);
    // The input is left alone.
    expect(checks.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('recordedMessage', () => {
  const base: RecordedRun = {
    checks: 24, assetsFailed: 0, defects: 0, notTested: 0,
    onJob: 0, notQueued: 0, critical: false, jobsUnreadable: false, openJobs: 0,
  };

  it('is one line when nothing failed', () => {
    expect(recordedMessage(base)).toBe('Recorded 24 checks.');
    expect(recordedMessage({ ...base, checks: 1, notTested: 3 })).toBe('Recorded 1 check, 3 not tested.');
  });

  it('says where the defects went when there is one open job', () => {
    expect(recordedMessage({ ...base, assetsFailed: 2, defects: 2, job: '9001', onJob: 2 }))
      .toBe('Recorded 24 checks, 2 assets failed, 2 defects.\n\nDefects queued to job 9001.');
    expect(recordedMessage({ ...base, assetsFailed: 1, defects: 1, job: '9001', onJob: 1, critical: true }))
      .toContain('Send the critical defect notice from Waiting to send.');
    expect(recordedMessage({ ...base, defects: 2, job: '9001', onJob: 1, notQueued: 1 }))
      .toContain("1 defect didn't queue. Ring the office.");
  });

  it('says the office was not told, and what to do, when there is no one job', () => {
    expect(recordedMessage({ ...base, defects: 1, jobsUnreadable: true })).toContain('Send it from Waiting to send.');
    expect(recordedMessage({ ...base, defects: 1, openJobs: 3 })).toContain('3 open jobs here. Pick one on Waiting to send.');
    expect(recordedMessage({ ...base, defects: 1 })).toContain('No open job here. Ring the office with the defects.');
  });
});

describe('the run screen', () => {
  const source = codeOf(readFileSync(join(__dirname, '..', '..', 'app', 'routine', 'run.tsx'), 'utf8'));

  it('writes each asset\'s result once, from all of its checks', () => {
    expect(source).toContain('assetResult(answers.map((x) => x.verdict))');
    // The per-check write that let a later pass overwrite a fail.
    expect(source).not.toContain("lastResult: a.verdict === 'fail' ? 'fail' : 'pass'");
  });

  it('names the screen the run is sent from by its title', () => {
    expect(source).not.toMatch(/Send screen/);
    expect(source).toContain('Waiting to send');
  });
});
