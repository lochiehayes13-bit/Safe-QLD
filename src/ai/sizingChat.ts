import { complete } from './client';
import type { CircuitPhase, ConductorMaterial } from '@/calc/cable';

/**
 * Describing an install in your own words, and getting a cable back.
 *
 * "Feeding a 15 kW three phase pump 60 metres away, TPS in a wall through
 * insulation, four other circuits in the same run" is how the question
 * actually arrives — and turning that into fourteen numbered fields is what
 * makes a sparky use the app once and never again.
 *
 * So a model reads the sentence. That is the whole of its job: **it extracts
 * facts, it never sizes anything.** It may not name a conductor size, a
 * breaker rating or a current-carrying capacity, and if it does the answer is
 * stripped out here and the screen says it tried. The size comes from
 * `@/domain/sizingChat` picking a table and `@/calc/cable` running the four
 * checks over it, exactly as it would if every field had been typed by hand.
 *
 * That is the same rule the detector-label reader follows, for the same
 * reason: a model that is confidently wrong about a number is worse than no
 * model at all, and the number here ends up in a wall.
 *
 * What leaves the phone is the sentence the technician typed and the list of
 * cable arrangements the app holds. Nothing about the site, the job or the
 * customer goes with it.
 */

export const SIZING_SYSTEM_PROMPT = [
  'You read a description of an electrical installation and extract the facts needed to size a cable.',
  '',
  'ABSOLUTE RULES:',
  '- You never give a cable size, a conductor cross-section, a breaker or fuse rating, or a current-carrying capacity.',
  '- You never convert, estimate or infer a number that was not stated. If the length was not given, it is missing.',
  '- You never assume a standard value. 230 V is not a default; if no voltage was stated, it is missing.',
  '- You answer with JSON only. No prose, no explanation, no markdown fence.',
  '',
  'Shape:',
  '{"loadWatts": number|null, "loadAmps": number|null, "loadKind": string, "volts": number|null,',
  ' "phase": "dc"|"single"|"three"|null, "powerFactor": number|null, "lengthM": number|null,',
  ' "installMethod": string, "insulation": string, "material": "copper"|"aluminium"|null,',
  ' "cores": string, "ambientC": number|null, "groupedCircuits": number|null,',
  ' "inInsulation": boolean|null, "buriedDepthM": number|null, "voltDropLimitPercent": number|null,',
  ' "faultA": number|null, "clearingTimeS": number|null, "missing": [string], "quoted": [{"field": string, "phrase": string}]}',
  '',
  '- loadKind: what the load is, in the words used — "pump", "oven", "lighting", "air conditioner". "" if not said.',
  '- installMethod: how and where it runs, in the words used — "in conduit in a wall", "buried direct",',
  '  "on a cable tray", "through ceiling insulation". "" if not said.',
  '- insulation: the cable designation if said — "V-75", "TPS", "XLPE", "X-90". "" if not said.',
  '- cores: "single core", "two core and earth", "three core and earth", "four core", as said. "" if not said.',
  '- groupedCircuits: how many circuits share the enclosure or tray IN TOTAL, including this one, if said.',
  '- missing: the fields a person would still have to be asked for, named in plain words:',
  '  "how long the run is", "the supply voltage", "how it is installed".',
  '- quoted: for every field you filled, the exact words from the description that filled it.',
  '  This is what lets the technician check you read the sentence right.',
  '',
  'If the description is not about an electrical installation at all, return every field null or empty',
  'with missing: ["this does not describe an install"].',
].join('\n');

/** The facts a description yielded, after everything unsafe was stripped. */
export interface SizingBrief {
  loadWatts?: number;
  loadAmps?: number;
  loadKind?: string;
  volts?: number;
  phase?: CircuitPhase;
  powerFactor?: number;
  lengthM?: number;
  installMethod?: string;
  insulation?: string;
  material?: ConductorMaterial;
  cores?: string;
  ambientC?: number;
  groupedCircuits?: number;
  inInsulation?: boolean;
  buriedDepthM?: number;
  voltDropLimitPercent?: number;
  faultA?: number;
  clearingTimeS?: number;
  /** What a person would still have to be asked. */
  missing: string[];
  /** The words that filled each field, so the reading can be checked. */
  quoted: { field: string; phrase: string }[];
  /**
   * Answers the model gave that it was told not to give — a size, a breaker,
   * a capacity. Kept so the screen can say it tried, and ignored otherwise.
   */
  refused: string[];
}

const PHASES: CircuitPhase[] = ['dc', 'single', 'three'];

function num(value: unknown, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (value < min || value > max) return undefined;
  return value;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Reads the model's JSON, keeping only what it was asked for.
 *
 * Anything outside the shape is dropped rather than passed through — a field
 * the model invented is a field nothing downstream knows how to check. The
 * one exception is a field that looks like an answer: those are moved into
 * `refused` and named, because a model that answered anyway is worth telling
 * the technician about.
 */
export function readSizingBrief(raw: string): SizingBrief | { refusal: string } {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return { refusal: 'The reply was not the JSON it was asked for.' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return { refusal: 'The reply was not readable as JSON.' };
  }
  if (!parsed || typeof parsed !== 'object') return { refusal: 'The reply was not an object.' };

  const o = parsed as Record<string, unknown>;
  const refused: string[] = [];

  // The three things it was told never to give. Named rather than silently
  // dropped: a technician who sees "it suggested 16 mm²" and then sees the
  // calculator say 25 mm² has learnt something about trusting the chat.
  for (const [key, label] of [
    ['areaMm2', 'a cable size'],
    ['cableSize', 'a cable size'],
    ['sizeMm2', 'a cable size'],
    ['breakerA', 'a breaker rating'],
    ['deviceRatingA', 'a breaker rating'],
    ['protectionA', 'a breaker rating'],
    ['capacityA', 'a current-carrying capacity'],
    ['currentCarryingCapacity', 'a current-carrying capacity'],
  ] as const) {
    if (o[key] !== undefined && o[key] !== null) refused.push(`${label} (${String(o[key])})`);
  }

  const phaseRaw = typeof o.phase === 'string' ? o.phase.toLowerCase().trim() : '';
  const phase = PHASES.find((p) => p === phaseRaw)
    ?? (phaseRaw.includes('three') || phaseRaw.startsWith('3') ? 'three'
      : phaseRaw.includes('single') || phaseRaw.startsWith('1') ? 'single'
        : phaseRaw === 'dc' ? 'dc' : undefined);

  const materialRaw = typeof o.material === 'string' ? o.material.toLowerCase() : '';
  const material: ConductorMaterial | undefined = materialRaw.includes('alumin')
    ? 'aluminium'
    : materialRaw.includes('copper') || materialRaw === 'cu' ? 'copper' : undefined;

  const missing = Array.isArray(o.missing)
    ? o.missing.filter((m): m is string => typeof m === 'string' && m.trim().length > 0).map((m) => m.trim())
    : [];

  const quoted = Array.isArray(o.quoted)
    ? o.quoted
      .filter((q): q is { field: string; phrase: string } => Boolean(
        q && typeof q === 'object'
        && typeof (q as { field?: unknown }).field === 'string'
        && typeof (q as { phrase?: unknown }).phrase === 'string',
      ))
      .map((q) => ({ field: q.field.trim(), phrase: q.phrase.trim() }))
      .filter((q) => q.field && q.phrase)
    : [];

  return {
    loadWatts: num(o.loadWatts, { min: 0.1, max: 5_000_000 }),
    loadAmps: num(o.loadAmps, { min: 0.01, max: 10_000 }),
    loadKind: text(o.loadKind),
    volts: num(o.volts, { min: 1, max: 33_000 }),
    phase,
    // A power factor outside 0 to 1 is a misread, not a load.
    powerFactor: (() => {
      const pf = num(o.powerFactor, { min: 0.01, max: 1 });
      return pf;
    })(),
    lengthM: num(o.lengthM, { min: 0.1, max: 100_000 }),
    installMethod: text(o.installMethod),
    insulation: text(o.insulation),
    material,
    cores: text(o.cores),
    ambientC: num(o.ambientC, { min: -30, max: 120 }),
    groupedCircuits: num(o.groupedCircuits, { min: 1, max: 200 }),
    inInsulation: typeof o.inInsulation === 'boolean' ? o.inInsulation : undefined,
    buriedDepthM: num(o.buriedDepthM, { min: 0.05, max: 10 }),
    voltDropLimitPercent: num(o.voltDropLimitPercent, { min: 0.5, max: 20 }),
    faultA: num(o.faultA, { min: 1, max: 200_000 }),
    clearingTimeS: num(o.clearingTimeS, { min: 0.001, max: 30 }),
    missing,
    quoted,
    refused,
  };
}

/**
 * The prompt, with the arrangements the app can actually size against.
 *
 * Without them the model describes an installation in words no table uses —
 * "in the roof space" — and the matching downstream has nothing to match. With
 * them it tends to answer in the standard's own vocabulary, which is what the
 * picker is keyed on.
 */
export function sizingPrompt(description: string, arrangements: readonly string[]): string {
  const sample = [...new Set(arrangements)].slice(0, 60);
  return [
    'The install, in the technician’s words:',
    description.trim(),
    '',
    'For installMethod, prefer the closest of these phrases where one fits; otherwise use their own words:',
    ...sample.map((a) => `- ${a}`),
  ].join('\n');
}

export interface SizingChatResult {
  brief?: SizingBrief;
  /** Why nothing came back, in words a screen can print. */
  refusal?: string;
  failure?: 'no-key' | 'key-rejected' | 'rate-limited' | 'service' | 'empty' | 'no-answer';
}

/** Asks the model to read one description. Never sizes anything itself. */
export async function readInstall(description: string, arrangements: readonly string[]): Promise<SizingChatResult> {
  if (!description.trim()) return { refusal: 'Describe the install first.' };

  const answer = await complete({
    system: SIZING_SYSTEM_PROMPT,
    user: sizingPrompt(description, arrangements),
    maxTokens: 900,
  });

  if (answer.failure) {
    return { failure: answer.failure, refusal: answer.refusal ?? 'The reading could not be done.' };
  }
  if (!answer.text?.trim()) return { failure: 'empty', refusal: 'Nothing came back.' };

  const read = readSizingBrief(answer.text);
  if ('refusal' in read) return { refusal: read.refusal };
  return { brief: read };
}
