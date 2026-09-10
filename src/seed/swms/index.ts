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
    words: ['detection', 'alarm', 'fip', 'panel', 'annual', 'routine', 'test', 'monthly', 'brigade', 'ase'],
  },
  'hot-work': {
    words: ['weld', 'grind', 'cut', 'solder', 'braze', 'hot work', 'install', 'pipe'],
  },
  heights: {
    systems: ['detection', 'sprinkler', 'ews', 'emergency-lighting'],
    routineIds: ['det-annual', 'spr-annual', 'eel-six-monthly', 'asd-six-monthly'],
    words: ['ceiling', 'roof', 'ladder', 'ewp', 'scissor', 'boom', 'height', 'detector', 'sprinkler', 'valve'],
  },
  'confined-space': {
    words: ['tank', 'pit', 'well', 'riser', 'confined', 'internal inspection'],
  },
  electrical: {
    systems: ['detection'],
    words: ['battery', 'batteries', 'wiring', 'cable', 'mains', 'submain', 'electrical', 'panel', 'power', 'fault'],
  },
  'hydrant-flow': {
    systems: ['hydrant', 'pump'],
    routineIds: ['hyd-annual', 'hydrant-five-yearly', 'pmp-monthly', 'pump-five-yearly'],
    words: ['hydrant', 'booster', 'flow', 'pump', 'form 72', 'pressure'],
  },
  'extinguisher-cylinders': {
    systems: ['extinguisher', 'gas'],
    routineIds: ['ext-six-monthly', 'ext-five-yearly'],
    words: ['extinguisher', 'cylinder', 'gas', 'co2', 'suppression', 'refill', 'pressure test'],
  },
  'traffic-lone': {
    systems: ['hydrant'],
    words: ['booster', 'carpark', 'basement', 'street', 'alone', 'after hours', 'night'],
  },
  'asbestos-silica': {
    words: ['drill', 'core', 'mount', 'install', 'new device', 'relocate', 'ceiling'],
  },
  'sprinkler-wet': {
    systems: ['sprinkler'],
    routineIds: ['spr-annual', 'sprinkler-five-yearly'],
    words: ['sprinkler', 'valve', 'drain', 'isolate', 'wet', 'alarm valve'],
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
