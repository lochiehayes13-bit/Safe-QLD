import * as SecureStore from 'expo-secure-store';
import {
  MAX_PASSAGES, SYSTEM_PROMPT, buildPrompt, checkAnswer, worthAsking,
  type GroundedAnswer, type GroundedQuestion,
} from './grounding';

/**
 * The network half of every language-model feature in the app.
 *
 * Thin on purpose. Every decision worth testing — what gets sent, whether it is
 * worth sending, and whether the answer can be trusted — lives in the pure
 * module beside each feature (grounding.ts, defectWording.ts, jobBrief.ts).
 * This part only carries it over the wire, and it does that in one place so
 * there is exactly one endpoint, one model id and one way of reading a key.
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
  // Never leaves this device in a backup, and cannot be read while it is
  // locked: the same terms the Simpro secret is kept on.
  await SecureStore.setItemAsync(KEY_SLOT, key.trim(), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}

export async function hasKey(): Promise<boolean> {
  return (await SecureStore.getItemAsync(KEY_SLOT)) !== null;
}

export async function clearKey(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY_SLOT);
}

/** Why a completion did not come back, for the caller to word in its own terms. */
export type CompletionFailure = 'no-key' | 'key-rejected' | 'rate-limited' | 'service' | 'empty' | 'no-answer';

export interface Completion {
  /** The model's text, joined across content blocks. Undefined on any failure. */
  text?: string;
  /** A short reason, in words. Present exactly when `text` is not. */
  refusal?: string;
  failure?: CompletionFailure;
}

/**
 * One round trip: a system instruction, a user message, a text answer.
 *
 * Never throws. Every failure — no key, no signal, a rejected key, a rate
 * limit — comes back as a refusal, because everything that calls this sits on
 * top of a feature that already works without it and must never take the
 * screen down. The caller decides what to say about the refusal; the reason
 * is here so it can.
 *
 * What is sent is exactly the two strings handed in, and the photograph
 * where one is given. This function adds no context of its own, so a caller
 * that has been careful about what it puts in `user` can be sure that is all
 * that left the phone.
 */
/** A photograph handed to the model alongside the words, already shrunk and encoded. */
export interface CompletionImage {
  base64: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
}

/**
 * The message body, as the API takes it.
 *
 * Text alone stays exactly the string it always was. With a photograph the
 * content becomes blocks — the image first, then the words — which is the
 * one shape the API reads a picture in. Pure so the label reader's test can
 * see what would be sent without a key.
 */
export function messageContent(user: string, images?: readonly CompletionImage[]): string | { type: string; source?: unknown; text?: string }[] {
  if (!images?.length) return user;
  return [
    ...images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mediaType, data: i.base64 } })),
    { type: 'text', text: user },
  ];
}

export async function complete(input: { system: string; user: string; maxTokens?: number; images?: readonly CompletionImage[] }): Promise<Completion> {
  const key = await SecureStore.getItemAsync(KEY_SLOT);
  if (!key) return { failure: 'no-key', refusal: 'No API key is set.' };

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
        max_tokens: input.maxTokens ?? MAX_TOKENS,
        system: input.system,
        messages: [{ role: 'user', content: messageContent(input.user, input.images) }],
      }),
    });

    if (!response.ok) {
      if (response.status === 401) return { failure: 'key-rejected', refusal: 'The API key was rejected.' };
      if (response.status === 429) return { failure: 'rate-limited', refusal: 'Rate limited — try again shortly.' };
      return { failure: 'service', refusal: `The service returned ${response.status}.` };
    }

    const body = await response.json() as { content?: { type: string; text?: string }[] };
    const text = (body.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n')
      .trim();
    if (!text) return { failure: 'empty', refusal: 'The model returned nothing.' };
    return { text };
  } catch {
    return { failure: 'no-answer', refusal: 'No answer came back — most likely no signal.' };
  }
}

/**
 * Answers a question from retrieved passages, or says why it did not.
 *
 * Never throws. Every failure comes back as a refusal a technician can read,
 * because this sits under a search that already answered and must never take
 * the screen down with it. The wording is this feature's own: every refusal
 * points back at the passages, which are the answer whether or not the model
 * had anything to add.
 */
export async function askGrounded(input: GroundedQuestion): Promise<GroundedAnswer> {
  const worth = worthAsking(input);
  if (!worth.ok) return { cited: [], refusal: worth.reason };

  const result = await complete({ system: SYSTEM_PROMPT, user: buildPrompt(input), maxTokens: MAX_TOKENS });

  if (result.text === undefined) {
    switch (result.failure) {
      case 'no-key':
        return {
          cited: [],
          refusal: 'No API key is set, so the passages below are the answer. Everything else in this '
            + 'app works without one; this only reads what the search already found.',
        };
      case 'no-answer':
        return {
          cited: [],
          refusal: 'No answer came back — most likely no signal. The passages below were found on this '
            + 'device and do not need one.',
        };
      case 'empty':
        // checkAnswer words the empty case; keep that one voice.
        return checkAnswer('', input.passages.slice(0, MAX_PASSAGES));
      default:
        return { cited: [], refusal: `${result.refusal ?? 'No answer.'} The passages below are what the search found.` };
    }
  }

  return checkAnswer(result.text, input.passages.slice(0, MAX_PASSAGES));
}
