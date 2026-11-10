/**
 * Device address calculator for addressable fire detection.
 *
 * Three distinct mechanisms are modelled, because getting them confused is how
 * an address ends up wrong on site:
 *
 *  - Binary DIP/DIL switches. On every device verified against a manufacturer
 *    manual, the switch printed "1" carries weight 1. There is no MSB-first
 *    variant; what techs call a "reversed bank" is the block mounted rotated,
 *    which is a display problem, not different arithmetic.
 *  - Apollo XPERT cards. Mechanically the inverse of a DIP switch: the address
 *    is the sum of the pips REMOVED, not the ones left in place. Removal is
 *    permanent.
 *  - Rotary decade switches. The tens dial has sixteen positions, not ten,
 *    which is why the range reaches 159 rather than stopping at 99.
 */

export type AddressingMethod =
  | 'dip'
  | 'xpert7'
  | 'xpert8'
  | 'rotary'
  | 'programmer';

export interface Protocol {
  id: string;
  label: string;
  minAddress: number;
  maxAddress: number;
  /** Switches that form the address. Null where the device has none. */
  switchCount: number | null;
  methods: AddressingMethod[];
  /** Total switches physically present, when more than the address uses. */
  physicalSwitchCount?: number;
  maxDevicesPerLoop: number;
  notes: string;
}

export const PROTOCOLS: Protocol[] = [
  {
    id: 'apollo_xp95',
    label: 'Apollo XP95',
    minAddress: 1, maxAddress: 126, switchCount: 7,
    methods: ['xpert7', 'dip'],
    maxDevicesPerLoop: 126,
    notes: 'Detectors use the XPERT card in the base. Call points and interfaces use a 7-way DIL switch. Max 126, not 127.',
  },
  {
    id: 'apollo_discovery',
    label: 'Apollo Discovery',
    minAddress: 1, maxAddress: 126, switchCount: 7,
    methods: ['xpert7', 'dip'],
    maxDevicesPerLoop: 126,
    notes: 'Addressed the same as XP95. Max 126.',
  },
  {
    id: 'apollo_coreprotocol',
    label: 'Apollo Soteria / CoreProtocol',
    minAddress: 1, maxAddress: 254, switchCount: 8,
    methods: ['xpert8', 'programmer'],
    maxDevicesPerLoop: 254,
    notes: 'XPERT 8 card or programmer. On an XP95 or Discovery base the 128 pip is ignored.',
  },
  {
    id: 'hochiki_esp',
    label: 'Hochiki ESP',
    minAddress: 1, maxAddress: 127, switchCount: 7,
    physicalSwitchCount: 8,
    methods: ['dip', 'programmer'],
    maxDevicesPerLoop: 127,
    notes: 'Only switches 1 to 7 set the address. Switch 8 varies by device; check its manual. 127 is valid.',
  },
  {
    id: 'simplex_idnet',
    label: 'Simplex IDNet',
    minAddress: 1, maxAddress: 250, switchCount: 8,
    methods: ['dip'],
    maxDevicesPerLoop: 250,
    notes: 'Switch 1 is the lowest bit. Max 250.',
  },
  {
    id: 'simplex_mapnet2',
    label: 'Simplex MAPNET II',
    minAddress: 1, maxAddress: 127, switchCount: 8,
    methods: ['dip'],
    maxDevicesPerLoop: 127,
    notes: 'Addressed the same as IDNet. Max 127.',
  },
  {
    id: 'ampac_firefinder',
    label: 'Ampac FireFinder',
    minAddress: 1, maxAddress: 126, switchCount: 7,
    methods: ['xpert7', 'dip'],
    maxDevicesPerLoop: 126,
    notes: 'Apollo protocol devices. Addressed the same as XP95.',
  },
  {
    id: 'notifier_flashscan',
    label: 'Notifier FlashScan',
    minAddress: 1, maxAddress: 159, switchCount: null,
    methods: ['rotary'],
    maxDevicesPerLoop: 159,
    notes: 'Detectors and modules have separate addresses. Detector 12 and module 12 do not clash.',
  },
  {
    id: 'notifier_clip',
    label: 'Notifier CLIP mode',
    minAddress: 1, maxAddress: 99, switchCount: null,
    methods: ['rotary'],
    maxDevicesPerLoop: 99,
    notes: 'Same hardware as FlashScan. Max 99 in CLIP mode.',
  },
  {
    id: 'pertronic_f220',
    label: 'Pertronic F220 / F120A',
    minAddress: 1, maxAddress: 159, switchCount: null,
    methods: ['rotary'],
    maxDevicesPerLoop: 159,
    notes: 'Rotary decade dials, not Apollo.',
  },
  {
    id: 'pertronic_f100a',
    label: 'Pertronic F100A',
    minAddress: 1, maxAddress: 99, switchCount: null,
    methods: ['rotary'],
    maxDevicesPerLoop: 99,
    // Split from the F220 entry, which asserted one ceiling for three panels.
    // The lower figure is the safe one to be unsure with: too low costs a
    // second look at the manual, too high hands out an address the panel
    // cannot poll and sends someone hunting a fault that is not there.
    notes: 'Max 99. Check the panel manual before going higher.',
  },
  {
    id: 'tyco_mx',
    label: 'Tyco / Vigilant MX',
    minAddress: 1, maxAddress: 250, switchCount: null,
    methods: ['programmer'],
    maxDevicesPerLoop: 250,
    notes: 'Set with the MX service tool. New devices ship at 255, which the panel shows as unaddressed.',
  },
  {
    id: 'brooks_firetracker',
    label: 'Brooks FireTracker / EBL',
    minAddress: 1, maxAddress: 255, switchCount: null,
    methods: ['programmer'],
    maxDevicesPerLoop: 255,
    notes: 'Set with the Brooks address setting tool.',
  },
];

export function protocolById(id: string): Protocol | undefined {
  return PROTOCOLS.find((p) => p.id === id);
}

// ---------------------------------------------------------------------------
// Binary DIP switches
// ---------------------------------------------------------------------------

/**
 * Address from a switch pattern.
 *
 * `switches[i]` is the switch printed as `i + 1`, carrying weight 2^i.
 * Only the first `count` switches contribute, which is what keeps Hochiki's
 * eighth switch out of the sum.
 */
export function switchesToAddress(switches: boolean[], count: number): number {
  let total = 0;
  for (let i = 0; i < count && i < switches.length; i++) {
    if (switches[i]) total += 2 ** i;
  }
  return total;
}

/** Switch pattern for an address, LSB at printed switch 1. */
export function addressToSwitches(address: number, count: number): boolean[] {
  const out: boolean[] = [];
  for (let i = 0; i < count; i++) {
    out.push(((address >> i) & 1) === 1);
  }
  return out;
}

/** Renders a pattern as the "1101000" strings printed on manufacturer charts. */
export function switchesToPattern(switches: boolean[], count: number): string {
  return Array.from({ length: count }, (_, i) => (switches[i] ? '1' : '0')).join('');
}

export function patternToSwitches(pattern: string): boolean[] {
  return pattern.split('').map((c) => c === '1');
}

// ---------------------------------------------------------------------------
// Apollo XPERT cards
// ---------------------------------------------------------------------------

export interface XpertPip {
  value: number;
  column: number;
  row: number;
  /** False for the 128 pip, which only exists on the XPERT 8 card. */
  onXpert7: boolean;
}

/** Pips sit in a two-row zigzag of pairs, as printed on the card. */
export const XPERT_PIPS: XpertPip[] = [
  { value: 1, column: 0, row: 0, onXpert7: true },
  { value: 2, column: 0, row: 1, onXpert7: true },
  { value: 4, column: 1, row: 0, onXpert7: true },
  { value: 8, column: 1, row: 1, onXpert7: true },
  { value: 16, column: 2, row: 0, onXpert7: true },
  { value: 32, column: 2, row: 1, onXpert7: true },
  { value: 64, column: 3, row: 0, onXpert7: true },
  { value: 128, column: 3, row: 1, onXpert7: false },
];

/**
 * Address from an XPERT card.
 *
 * The address is the sum of the pips REMOVED — the inverse of a DIP switch.
 */
export function removedPipsToAddress(removed: number[]): number {
  return removed.reduce((n, v) => n + v, 0);
}

/** Which pips to punch out for an address. */
export function addressToRemovedPips(address: number, xpert8 = false): number[] {
  const pips = XPERT_PIPS.filter((p) => xpert8 || p.onXpert7);
  return pips.filter((p) => (address & p.value) === p.value).map((p) => p.value);
}

// ---------------------------------------------------------------------------
// Rotary decade switches
// ---------------------------------------------------------------------------

/**
 * Address from rotary dials.
 *
 * The tens dial has sixteen positions (0–15), not ten. That is exactly why the
 * range reaches 159 rather than stopping at 99.
 */
export function rotaryToAddress(tens: number, units: number): number {
  return tens * 10 + units;
}

export function addressToRotary(address: number): { tens: number; units: number } {
  return { tens: Math.floor(address / 10), units: address % 10 };
}

export const ROTARY_TENS_POSITIONS = 16;
export const ROTARY_UNITS_POSITIONS = 10;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface AddressIssue {
  level: 'error' | 'warning' | 'info';
  message: string;
}

/**
 * Checks an address against a protocol, and surfaces the field gotchas that
 * actually cost callbacks.
 */
export function validateAddress(address: number, protocol: Protocol, method: AddressingMethod): AddressIssue[] {
  const issues: AddressIssue[] = [];

  if (address === 0) {
    issues.push({ level: 'error', message: '0 means unaddressed. Set 1 or higher.' });
  } else if (address < protocol.minAddress || address > protocol.maxAddress) {
    issues.push({
      level: 'error',
      message: `${protocol.label} takes ${protocol.minAddress} to ${protocol.maxAddress}. ${address} is outside that range.`,
    });
  }

  if (protocol.id === 'hochiki_esp' && address >= 1 && address <= 127) {
    issues.push({
      level: 'info',
      message: `A base sounder on this device takes address ${address + 127} (sensor address + 127).`,
    });
  }

  if (method === 'xpert7' || method === 'xpert8') {
    issues.push({ level: 'warning', message: 'Removal is permanent. A wrongly punched card must be replaced.' });
    issues.push({ level: 'info', message: 'The card stays with the base. A new head keeps the address; a new base does not.' });
  }

  if (method === 'rotary' && address > 99) {
    issues.push({
      level: 'warning',
      message: 'Some modules have a moulded stop on the tens dial. Remove it to set above 99.',
    });
  }

  if (protocol.id === 'apollo_coreprotocol' && address > 126) {
    issues.push({
      level: 'warning',
      message: 'Above 126 needs the full CoreProtocol chain: XPERT 8 base and card, Soteria head, CoreProtocol panel.',
    });
  }

  return issues;
}

/** What the "Set to address" box holds, checked before anything is moved. */
export type TargetCheck =
  | { ok: true; address: number }
  | { ok: false; message: string };

/**
 * Reads a typed target address against the protocol's range.
 *
 * Undefined while the box is blank. Anything outside the range is refused
 * rather than written to the switches, because an 8-bit pattern for 200 on a
 * 7-switch device reads back as 72, a different valid address.
 */
export function checkTarget(text: string, protocol: Protocol): TargetCheck | undefined {
  const s = text.trim();
  if (!s) return undefined;
  if (!/^\d+$/.test(s)) return { ok: false, message: 'Whole numbers only.' };
  const address = Number(s);
  if (address < protocol.minAddress || address > protocol.maxAddress) {
    return { ok: false, message: `${protocol.label} takes ${protocol.minAddress} to ${protocol.maxAddress}.` };
  }
  return { ok: true, address };
}
