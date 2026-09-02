import { enqueueSync } from '@/db/opsRepo';
import {
  decideAssetTest,
  type AssetTestDecision,
  type AssetTestToSend,
} from '@/domain/assetTestDecision';

/**
 * Puts a decided test on the outbound queue.
 *
 * Thin on purpose: every rule about whether a result may be sent lives in
 * `decideAssetTest`, which touches no database and is tested directly. This is
 * only the part that needs one.
 */
export async function queueAssetTest(
  test: AssetTestToSend,
  writingEnabled: boolean,
): Promise<AssetTestDecision> {
  const decision = decideAssetTest(test, writingEnabled);
  if (decision.send) await enqueueSync('asset-test', decision.payload);
  return decision;
}
