/**
 * End-of-line resistor reference for panels commonly encountered in Australia.
 *
 * There is deliberately no universal "normal / alarm / fault" resistance table
 * here, because one does not exist. EOL value is per panel, per card and often
 * per configured mode, and several Australian panels sense current or voltage
 * bands rather than resistance — the F3200 decides alarm from the current a
 * latched detector draws, so no resistance window describes it. Shipping a
 * single table would be confidently wrong on most sites.
 *
 * Every entry names the panel it applies to and the manual it came from, and
 * the UI says plainly that the as-installed configuration governs.
 */

export interface EolEntry {
  brand: string;
  /** Panel or module the value applies to. */
  panel: string;
  /** Which circuit on that panel. */
  circuit: string;
  /** The value(s), verbatim from the manual. */
  value: string;
  notes?: string;
  confidence: 'high' | 'medium' | 'low';
  source?: string;
}

export const EOL_VALUES: EolEntry[] = [
  {
    brand: 'Ampac',
    panel: 'FireFinder PLUS / LoopSense 8 Zone Conventional Board',
    circuit: 'Conventional detection zone',
    value: '3K3, 4K7, 6K8 or 10K (programmable), or 10 µF for head removal',
    notes: '27 V DC. Max 25 mA alarm current per zone, 40 detectors per zone in Australia. Selected in the configuration software.',
    confidence: 'high',
    source: 'Ampac PDS4310-0082 8 Zone Conventional Board datasheet',
  },
  {
    brand: 'Ampac',
    panel: 'FireFinder Series 2 Conventional Zone Board',
    circuit: 'Conventional detection zone',
    value: '3K3',
    notes: '16 zones per board. Unused zones must still be terminated with 3K3.',
    confidence: 'high',
    source: 'Ampac MAN2986-2 FireFinder Series 2 Installation & Commissioning (AS)',
  },
  {
    brand: 'Ampac',
    panel: 'FireFinder Series 2 Brigade / PSU Monitor Board',
    circuit: 'Bell / sounder output, monitored ancillary output',
    value: '10K',
    notes: 'Reverse-polarity current monitoring — every alarm device needs a series diode, 1N4004 recommended. Two 2 A circuits.',
    confidence: 'high',
    source: 'Ampac MAN2986-2',
  },
  {
    brand: 'Ampac',
    panel: 'FireFinder Series 2 Brigade / PSU Monitor Board',
    circuit: 'DBA / MCP monitored input',
    value: '10K EOL with 4K7 series alarm resistor',
    notes: 'The door switch on the same terminal block is not monitored.',
    confidence: 'high',
    source: 'Ampac MAN2986-2',
  },
  {
    brand: 'Ampac',
    panel: 'FireFinder Series 2',
    circuit: 'Extinguishant monitored input (TB2)',
    value: '22K EOL with 4K7 series resistor',
    notes: 'Works with normally-open or normally-closed contacts; contact type is set in programming.',
    confidence: 'high',
    source: 'Ampac MAN2986-2',
  },
  {
    brand: 'Vigilant',
    panel: 'F3200 8 Zone Module (AZC)',
    circuit: 'Conventional alarm zone circuit',
    value: 'Standard and high current 2K7 5% 400 mW; low current 10K 5% 400 mW; tamper mode uses an active EOL',
    notes: 'Max circuit resistance 50 Ω in standard, high-current and tamper modes. Low-current mode allows 800 Ω for a B2 alarm and 2 kΩ for B3. The F3200 senses alarm by current band, not by resistance window.',
    confidence: 'high',
    source: 'Tyco LT0255 F3200 manual',
  },
  {
    brand: 'Vigilant',
    panel: 'F3200 MAF / PSU',
    circuit: 'Monitored input, supervised bell and ancillary output',
    value: 'One branch 3K3 5% 250 mW; two branches 6K8 each; three branches 10K each',
    notes: 'The parallel combination always totals 3K3. 100 V speaker branches use 10K 2 W each. The BELLS relay uses a 2K5 end-of-line device.',
    confidence: 'high',
    source: 'Tyco LT0255',
  },
  {
    brand: 'Vigilant',
    panel: 'F4000 ATR',
    circuit: 'Fire circuit',
    value: '3K3',
    notes: 'One of the few panels that publishes resistance bands — see the state table.',
    confidence: 'high',
    source: 'Tyco FP4KSYSM F4000 system manual',
  },
  {
    brand: 'Vigilant',
    panel: 'F4000 ATR',
    circuit: 'Non-fire / ancillary circuit',
    value: '10K',
    confidence: 'high',
    source: 'Tyco FP4KSYSM',
  },
  {
    brand: 'Vigilant',
    panel: 'MX1 controller',
    circuit: 'MCP input (J3-3)',
    value: '2K7',
    notes: 'Sensed by voltage: alarm below 0.35 V, normal 0.35–0.95 V with the EOL present, fault above 0.95 V.',
    confidence: 'high',
    source: 'Tyco LT0361 MX1 manual',
  },
  {
    brand: 'Vigilant',
    panel: 'MX1 AZM800 zone monitor',
    circuit: 'Conventional zone',
    value: '9K1 normal, 18K low current',
    confidence: 'high',
    source: 'Tyco LT0361',
  },
  {
    brand: 'Vigilant',
    panel: 'MIM800 / CIM800',
    circuit: 'Normally-open input, fault on short',
    value: '200 Ω EOL with 100 Ω in series with the alarm contacts',
    notes: 'Only one alarm contact is permitted in this configuration.',
    confidence: 'high',
    source: 'Tyco LT0361',
  },
  {
    brand: 'Simplex',
    panel: '4100ES 8 Zone Module',
    circuit: 'Conventional detection zone',
    value: '3K3',
    confidence: 'high',
    source: 'Simplex 4100ES documentation',
  },
  {
    brand: 'Pertronic',
    panel: 'F16E / F4 / F100Lr conventional zone',
    circuit: 'Conventional detection zone',
    value: '10K EOL. Alarm resistors: 470R smoke, 180R heat, 1K8 defect',
    notes: 'Four-state signalling into a single conventional zone by switching resistor values. Open or short reads as defect.',
    confidence: 'medium',
    source: 'Pertronic / System Sensor interfacing documentation',
  },
  {
    brand: 'System Sensor',
    panel: 'M210EA-CZR conventional detector base',
    circuit: 'Conventional zone',
    value: '470 Ω alarm resistor base',
    notes: 'The base presents 470 Ω on alarm rather than a short circuit.',
    confidence: 'high',
    source: 'System Sensor I56-4413-000_B',
  },
];

/** Published state boundaries, for the few panels that publish any. */
export interface ZoneStateTable {
  panel: string;
  circuit: string;
  /** Null where the panel does not sense by resistance at all. */
  bands: { range: string; state: string }[] | null;
  method: string;
  notes?: string;
  source?: string;
}

export const ZONE_STATE_TABLES: ZoneStateTable[] = [
  {
    panel: 'Vigilant F4000 ATR',
    circuit: 'Fire circuit with 3K3 EOL',
    method: 'Resistance between terminals',
    bands: [
      { range: 'Short to 1K5', state: 'Defect' },
      { range: '1K5 to 5K5', state: 'Normal' },
      { range: '5K5 to 16K9', state: 'Alarm' },
      { range: '16K9 to open', state: 'Alarm' },
    ],
    notes: 'Values are nominal. Open circuit reads as alarm; short circuit reads as defect. The 3K3 EOL sits at 1.79 V.',
    source: 'Tyco FP4KSYSM',
  },
  {
    panel: 'Vigilant F4000 ATR',
    circuit: 'Non-fire circuit with 10K EOL',
    method: 'Resistance between terminals',
    bands: [
      { range: 'Short to 1K5', state: 'Defect' },
      { range: '1K5 to 5K5', state: 'Defect' },
      { range: '5K5 to 16K9', state: 'Normal' },
      { range: '16K9 to open', state: 'Alarm' },
    ],
    notes: 'Same boundaries as the fire circuit, mapped to different states. The 10K EOL sits at 3.14 V.',
    source: 'Tyco FP4KSYSM',
  },
  {
    panel: 'Vigilant MX1 controller',
    circuit: 'MCP input with 2K7 EOL',
    method: 'Voltage at the input',
    bands: [
      { range: 'Below 0.35 V', state: 'Alarm' },
      { range: '0.35 to 0.95 V', state: 'Normal' },
      { range: 'Above 0.95 V', state: 'Fault' },
    ],
    source: 'Tyco LT0361',
  },
  {
    panel: 'Vigilant F3200 AZC',
    circuit: 'Conventional alarm zone circuit',
    method: 'Current band, not resistance',
    bands: null,
    notes:
      'The F3200 decides alarm from the current a latched detector draws, so no resistance window describes it. Mode 3: up to 34.3 mA into a short, 14.2–15.3 mA into 800 Ω for a B2 alarm, 8.0–8.4 mA into 2 kΩ for B3. Fault thresholds 0.85–1.59 mA, EOL current 2 mA.',
    source: 'Tyco LT0255',
  },
  {
    panel: 'Ampac FireFinder 8 Zone Conventional Board',
    circuit: 'Conventional detection zone',
    method: 'States reported, thresholds not published',
    bands: null,
    notes:
      'The board reports normal, open circuit, short circuit and alarm, but publishes no resistance boundaries. Thresholds move with the selected EOL, so obtain them from Ampac for the configured value.',
    source: 'Ampac PDS4310-0082',
  },
];

/** Brands present in the reference, for the filter chips. */
export function eolBrands(): string[] {
  return [...new Set(EOL_VALUES.map((e) => e.brand))].sort();
}

export function eolFor(brand?: string): EolEntry[] {
  return brand ? EOL_VALUES.filter((e) => e.brand === brand) : EOL_VALUES;
}
