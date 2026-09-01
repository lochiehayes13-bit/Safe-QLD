import * as SecureStore from 'expo-secure-store';
import {
  MAX_PASSAGES, SYSTEM_PROMPT, buildPrompt, checkAnswer, worthAsking,
  type GroundedAnswer, type GroundedQuestion,
} from './grounding';

/**
 * The network half of the grounded answer.
 *
 * Thin on purpose. Every decision worth testing — what gets sent, whether it is
 * worth sending, and whether the answer can be trusted — lives in grounding.ts,
 * which is pure. This part only carries it over the wire.
 *
 * The key is held in the platform keystore rather than ordinary app storage,
 * the same as the Simpro client secret, and for the same reason: a key on a
 * technician's phone is a real risk and the hardware keystore is the least bad
 * place for one.
 */

const KEY_SLOT = 'safeqld.anthropic.key';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-5';
/** Brief answers only; a technician is holding a torch. */
const MAX_TOKENS = 400;

export async function storeKey(key: string): Promise<void> {
  await SecureStore.setItemAsync(KEY_SLOT, key.trim());
}

export async function hasKey(): Promise<boolean> {
  return (await SecureStore.getItemAsync(KEY_SLOT)) !== null;
}

export async function clearKey(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY_SLOT);
}

/**
 * Answers a question from retrieved passages, or says why it did not.
 *
 * Never throws. Every failure — no key, no signal, a refusal, a rate limit —
 * comes back as a refusal a technician can read, because this sits under a
 * search that already answered and must never take the screen down with it.
 */
export async function askGrounded(input: GroundedQuestion): Promise<GroundedAnswer> {
  const worth = worthAsking(input);
  if (!worth.ok) return { cited: [], refusal: worth.reason };

  const key = await SecureStore.getItemAsync(KEY_SLOT);
  if (!key) {
    return {
      cited: [],
      refusal: 'No API key is set, so the passages below are the answer. Everything else in this '
        + 'app works without one; this only reads what the search already found.',
    };
  }

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildPrompt(input) }],
      }),
    });

    if (!response.ok) {
      const detail = response.status === 401 ? 'The API key was rejected.'
        : response.status === 429 ? 'Rate limited — try again shortly.'
          : `The service returned ${response.status}.`;
      return { cited: [], refusal: `${detail} The passages below are what the search found.` };
    }

    const body = await response.json() as { content?: { type: string; text?: string }[] };
    const text = (body.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n');

    return checkAnswer(text, input.passages.slice(0, MAX_PASSAGES));
  } catch {
    return {
      cited: [],
      refusal: 'No answer came back — most likely no signal. The passages below were found on this '
        + 'device and do not need one.',
    };
  }
}
