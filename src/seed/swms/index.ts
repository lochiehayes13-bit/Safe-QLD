import type { SwmsSuggestion, SwmsTemplate } from '@/domain/swms';
import templates from './templates.json';

/**
 * The company's safe work method statements.
 *
 * The content is authored as JSON — steps, hazards, controls in hierarchy
 * order, the residual risk after them, and the Queensland high-risk
 * construction work categories the activity falls under. It is data rather
 * than code because it is the company's method, not the app's logic: it is
 * reviewed by people who do not read TypeScript, and it changes when Safe QLD
 * changes how the work is done.
 *
 * What is wired in code is the suggestion: which statements the app puts up
 * when a technician is standing at a site with hydrants and a detection annual
 * due. That is app behaviour rather than method, and it is the part that stops
 * a crew forgetting the second statement — a hydrant flow test is also a
 * traffic job, and a detection annual is also a height job, every time.
 *
 * A note on where this content comes from. It was written for this company's
 * work from the Work Health and Safety Act and Regulation 2011 (Qld), the
 * Codes of Practice published by Workplace Health and Safety Queensland, and
 * the Australian Standards that govern each activity, and every statement
 * carries the references it was written to. It is not a reproduction of any
 * licensed document. The company still owns it: the person who signs it is
 * accepting that it describes how the work will actually be done here.
 */

/**
 * What puts each statement in front of a technician.
 *
 * Kept beside the loader rather than in the JSON so that the authored content
 * stays about the work, and so a system name changing in the register is a
 * one-line change here rather than an edit to ten documents.
 */
const SUGGESTIONS: Record<string, SwmsSuggestion> = {
  'live-testing': {
    systems: ['detection', 'ews', 'aspirating'],
    routineIds: ['det-monthly', 'det-annual', 'ews-annual', 'asd-six-monthly'],
    words: [
      'detection', 'detector', 'detectors', 'smoke alarm', 'fip', 'fire indicator panel',
      'brigade', 'ase', 'asdu', 'monitoring', 'evacuation', 'eward', 'wip', 'occupant warning',
      'aspirating', 'vesda', 'block plan', 'zone', 'zones', 'sounder', 'strobe', 'mcp',
      'call point', 'functional test', 'as 1851',
    ],
    // Every statement here mentions a panel and a test. On their own they say
    // nothing about which one the day needs.
    weakWords: ['panel', 'test', 'testing', 'alarm', 'annual', 'routine', 'monthly', 'service'],
  },
  'hot-work': {
    words: [
      'weld', 'welding', 'grind', 'grinding', 'cut', 'cutting', 'saw cutting', 'solder',
      'soldering', 'braze', 'brazing', 'hot work', 'oxy', 'angle grinder', 'spark', 'sparks',
      'torch', 'thread', 'threading', 'pipework', 'bracketry', 'hot permit',
    ],
    weakWords: ['install', 'installation', 'pipe', 'steel', 'fabricate'],
  },
  heights: {
    systems: ['detection', 'sprinkler', 'ews', 'emergency-lighting'],
    routineIds: ['det-annual', 'spr-annual', 'eel-six-monthly', 'asd-six-monthly'],
    words: [
      'ceiling', 'ceilings', 'roof', 'ladder', 'ladders', 'ewp', 'scissor', 'scissor lift',
      'boom', 'boom lift', 'knuckle', 'height', 'heights', 'elevated', 'platform', 'scaffold',
      'harness', 'fall', 'fall arrest', 'anchor', 'edge', 'void', 'mezzanine', 'atrium',
      'high level', 'overhead', 'tank top', 'step ladder', 'above ceiling',
    ],
    weakWords: ['detector', 'detectors', 'sprinkler', 'valve', 'light', 'lights', 'exit sign'],
  },
  'confined-space': {
    words: [
      'confined', 'confined space', 'tank', 'tanks', 'water tank', 'wet well', 'pump well',
      'sump', 'chamber', 'vault', 'manhole', 'entry permit', 'gas test', 'atmosphere',
      'standby person', 'retrieval', 'tripod', 'internal inspection', 'inside the tank',
      'booster pit', 'valve pit', 'riser shaft',
    ],
    weakWords: ['pit', 'well', 'riser', 'entry', 'internal', 'ventilation'],
  },
  electrical: {
    systems: ['detection'],
    words: [
      'battery', 'batteries', 'battery bank', 'wiring', 'cable', 'cabling', 'mains', 'submain',
      'electrical', 'switchboard', 'circuit', 'circuits', 'megger', 'insulation resistance',
      'isolate the supply', 'lock out', 'tag out', 'loto', 'prove dead', 'energised', 'live work',
      'terminate', 'terminating', 'rcd', 'earth', 'earthing', '240', 'wiring rules', 'as 3000',
    ],
    weakWords: ['panel', 'power', 'supply', 'fault', 'charger', 'voltage'],
  },
  'hydrant-flow': {
    systems: ['hydrant', 'pump'],
    routineIds: ['hyd-annual', 'hydrant-five-yearly', 'pmp-monthly', 'pump-five-yearly'],
    words: [
      'hydrant', 'hydrants', 'booster', 'flow test', 'flowing', 'form 72', 'pitot', 'standpipe',
      'fire pump', 'pumpset', 'diesel pump', 'jockey', 'duty point', 'landing valve',
      'suction', 'hose off', 'run the pump', 'block plan test',
    ],
    weakWords: ['flow', 'pump', 'pressure', 'water', 'test'],
  },
  'extinguisher-cylinders': {
    words: [
      'extinguisher', 'extinguishers', 'cylinder', 'cylinders', 'co2', 'carbon dioxide',
      'suppression', 'refill', 'recharge', 'pressure test', 'hydrostatic', 'five yearly',
      'discharge', 'agent', 'fm200', 'novec', 'inergen', 'clean agent', 'off site',
      'manual handling', 'trolley',
    ],
    weakWords: ['gas', 'gaseous', 'weight', 'tag', 'sign'],
  },
  'traffic-lone': {
    systems: ['hydrant'],
    words: [
      'traffic', 'roadway', 'road', 'street', 'kerb', 'footpath', 'driveway', 'carpark',
      'car park', 'cones', 'witches hat', 'traffic control', 'alone', 'on my own', 'lone',
      'lone worker', 'after hours', 'night', 'nightshift', 'out of hours', 'no one else',
      'public area', 'shopping centre', 'occupied building',
    ],
    weakWords: ['booster', 'basement', 'loading dock', 'public'],
  },
  'asbestos-silica': {
    words: [
      'drill', 'drilling', 'core', 'coring', 'core drill', 'core hole', 'diamond drill',
      'chase', 'chasing', 'penetration', 'penetrations', 'slab', 'concrete', 'masonry',
      'brick', 'brickwork', 'blockwork', 'render', 'asbestos', 'acm', 'silica', 'dust',
      'lead paint', 'fibro', 'ac sheet', 'pre 1990', 'asbestos register', 'demolition',
      'cut in', 'new device', 'relocate', 'mount',
    ],
    weakWords: ['install', 'ceiling', 'wall', 'walls', 'riser', 'old building'],
  },
  'sprinkler-wet': {
    systems: ['sprinkler'],
    routineIds: ['spr-annual', 'sprinkler-five-yearly'],
    words: [
      'sprinkler', 'sprinklers', 'sprinkler head', 'alarm valve', 'stop valve',
      'drain', 'draining', 'drain down', 'charged', 'wet system', 'combined system',
      'flow switch', 'tamper', 'impairment', 'shut down the system', 'refill the system',
      'water damage', 'escutcheon',
    ],
    // "heads" is detector heads as often as sprinkler heads, and "replace three
    // heads" is a detection job far more often than a sprinkler one.
    weakWords: ['valve', 'wet', 'isolate', 'water', 'pipe', 'heads'],
  },
};

/**
 * The templates, with their suggestion wiring attached.
 *
 * A template with no entry above simply never suggests itself, which is the
 * safe direction: it is still in the library and a technician can pick it.
 */
export const SWMS_TEMPLATES: readonly SwmsTemplate[] = (templates as SwmsTemplate[]).map((t) => ({
  ...t,
  suggestFor: SUGGESTIONS[t.id],
}));

export function templateById(id: string): SwmsTemplate | undefined {
  return SWMS_TEMPLATES.find((t) => t.id === id);
}

/** Every statement that covers high-risk construction work, for the library's first section. */
export function highRiskTemplates(): SwmsTemplate[] {
  return SWMS_TEMPLATES.filter((t) => t.hrcw.length > 0);
}
