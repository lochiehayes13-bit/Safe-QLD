import type { OutboundAssetTest } from './outboundWork';

/**
 * Deciding whether a completed test goes back onto the asset in Simpro.
 *
 * This is the only outbound kind that edits an existing office record rather
 * than appending to one. A note or an order that goes wrong leaves something to
 * delete; this one overwrites the field the office schedules 12,546 live assets
 * from. So the decision is made here, once, and kept free of the database so it
 * can be tested directly rather than only through a queue that needs a device.
 */

export interface AssetTestToSend {
  /** Simpro's own id for the asset. A local id means nothing to the office. */
  externalAssetId?: string;
  /** Which frequency was serviced. */
  serviceLevelId?: string;
  result: 'pass' | 'fail' | 'na' | 'not-tested' | string;
  /** ISO timestamp of the test itself, not of the attempt to send it. */
  testedAt: string;
  description: string;
}

export type AssetTestRefusal =
  /** The feature is off. It ships off and stays off until someone turns it on. */
  | 'writing-disabled'
  /** The asset did not come from Simpro, so there is nothing there to update. */
  | 'no-external-id'
  /** Simpro records a result against a frequency; without one it says nothing. */
  | 'no-service-level'
  /**
   * Simpro's asset test has two values, Pass and Fail.
   *
   * An asset a technician could not reach is neither, and it is the commonest
   * real outcome on an annual. Sending it as a fail raises a defect that does
   * not exist; sending it as a pass claims a test that never happened. It stays
   * in the job note, in words, where the reason survives.
   */
  | 'result-not-expressible';

export type AssetTestDecision =
  | { send: true; payload: OutboundAssetTest }
  | { send: false; reason: AssetTestRefusal };

/** Whether this result can and should go back to Simpro, and as what. */
export function decideAssetTest(test: AssetTestToSend, writingEnabled: boolean): AssetTestDecision {
  if (!writingEnabled) return { send: false, reason: 'writing-disabled' };
  if (!test.externalAssetId) return { send: false, reason: 'no-external-id' };
  if (!test.serviceLevelId) return { send: false, reason: 'no-service-level' };

  const normalised = test.result.trim().toLowerCase();
  if (normalised !== 'pass' && normalised !== 'fail') {
    return { send: false, reason: 'result-not-expressible' };
  }

  return {
    send: true,
    payload: {
      externalAssetId: test.externalAssetId,
      serviceLevelId: test.serviceLevelId,
      result: normalised === 'pass' ? 'Pass' : 'Fail',
      testedAt: test.testedAt,
      description: test.description,
    },
  };
}

/** What to tell someone when a result is not going back to the office. */
export function explainRefusal(reason: AssetTestRefusal): string {
  switch (reason) {
    case 'writing-disabled':
      return 'Writing results back to Simpro is switched off. The result is saved here and is in the job note.';
    case 'no-external-id':
      return 'This asset was not created from Simpro, so there is no record there to update.';
    case 'no-service-level':
      return 'No service frequency is recorded against this asset, and Simpro files a result against one.';
    case 'result-not-expressible':
      return 'Simpro records only a pass or a fail. This result and its reason stay in the job note, in words.';
  }
}
