import type { EffectKind } from '@/domain/types';

/**
 * Maps an output's programmed label onto an effect class.
 *
 * Panels do not record what an output is *for* in any structured way. What
 * they record is the text a technician typed — "EVAC RELAY", "AHU 3 SHUTDOWN",
 * "LIFT HOMING". That text is the only evidence available, so this reads it,
 * on the same terms as the device-type normaliser: match confidently or return
 * nothing, and keep the original either way.
 *
 * Returning null matters more than matching. A cause-and-effect matrix is a
 * commissioning document; an output labelled "other" is a prompt to go and
 * look, while one confidently mislabelled "brigade signal" is a false record
 * of how the building behaves in a fire.
 */

const RULES: { kind: EffectKind; patterns: RegExp[] }[] = [
  // Brigade signalling first: "ASE" and "FIP" are unambiguous here, and an
  // alarm-signalling output must never be absorbed by a looser rule below.
  { kind: 'brigade-signal', patterns: [/\bBRIGADE\b/, /\bASE\b/, /\bFIRE\s*INDICATOR\b/, /\bMONITORING\b/, /\bALARM\s*SIGNAL/] },
  { kind: 'evacuation', patterns: [/\bEVAC(UATION|UATE)?\b/, /\bEWIS\b/, /\bALERT\s*(TONE|SIGNAL)\b/] },
  { kind: 'pressurisation', patterns: [/\bPRESSURI[SZ]/, /\bSTAIR\s*PRESS/] },
  { kind: 'smoke-control', patterns: [/\bSMOKE\s*(CONTROL|EXHAUST|SPILL|RELIEF)\b/, /\bSPILL\s*FAN\b/] },
  { kind: 'damper-close', patterns: [/\bDAMPER\b/, /\bFIRE\s*DAMPER\b/] },
  { kind: 'lift-homing', patterns: [/\bLIFT\b/, /\bELEVATOR\b/, /\bLIFT\s*HOMING\b/] },
  { kind: 'door-release', patterns: [/\bDOOR\s*(RELEASE|HOLD|MAG)/, /\bSHUTTER\b/, /\bMAG\s*LOCK\b/, /\bEXIT\s*DOOR\b/, /\bSEC(URITY)?\s*DOOR\b/] },
  { kind: 'ahu-shutdown', patterns: [/\bAHU\b/, /\bA\/?C\s*(SHUT|TRIP|OFF)/, /\bAIR\s*(HANDLING|CON)/, /\bFCU\b/, /\bFAN\s*(SHUT|TRIP|STOP|OFF)/] },
  { kind: 'gas-release', patterns: [/\bGAS\s*RELEASE\b/, /\bSUPPRESS/, /\bEXTINGUISH/, /\bFM200\b/, /\bINERGEN\b/] },
  { kind: 'strobes', patterns: [/\bSTROBE\b/, /\bBEACON\b/, /\bVAD\b/, /\bVISUAL\s*ALARM\b/] },
  { kind: 'sounders', patterns: [/\bSOUNDER\b/, /\bBELL\b/, /\bHORN\b/, /\bSIREN\b/] },
  { kind: 'occupant-warning', patterns: [/\bOCCUPANT\s*WARNING\b/, /\bOWS\b/, /\bWARNING\s*SYSTEM\b/, /\bWIP\b/] },
  // Last: a bare "shutdown"/"trip" is a plant control once nothing above claimed it.
  { kind: 'plant-shutdown', patterns: [/\bSHUT\s*DOWN\b/, /\bSHUTDOWN\b/, /\bPLANT\b/, /\bTRIP\b/, /\bMSSB\b/] },
];

/** Returns the effect class, or null when the label does not clearly say. */
export function effectKindFromLabel(label: string | undefined | null): EffectKind | null {
  if (!label) return null;
  const s = ` ${label.toUpperCase().replace(/[^A-Z0-9/]+/g, ' ').trim()} `;
  if (s.trim().length === 0) return null;
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(s))) return rule.kind;
  }
  return null;
}
