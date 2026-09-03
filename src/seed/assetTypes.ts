/**
 * Asset type catalogue.
 *
 * Every kind of equipment Safe QLD services is described here as data. A
 * detector, a fire pump, an extinguisher and a fire door differ only in their
 * attributes, so supporting a new class of equipment is an entry in this list
 * rather than a new screen.
 */

export type AttributeType = 'text' | 'number' | 'date' | 'select' | 'boolean';

export interface AttributeDef {
  key: string;
  label: string;
  type: AttributeType;
  unit?: string;
  options?: string[];
  /** Shown on the asset list row, not just the detail screen. */
  summary?: boolean;
}

export interface AssetTypeDef {
  id: string;
  label: string;
  /** Broad system, used for grouping and for AS 1851 routine selection. */
  system: SystemKind;
  icon: string;
  attributes: AttributeDef[];
  /** True when this type holds children, e.g. a panel holds loops. */
  container?: boolean;
  /** Prefix for generated asset codes, e.g. SQ-DET-0001847. */
  codePrefix: string;
}

export type SystemKind =
  | 'detection'
  | 'ews'
  | 'aspirating'
  | 'sprinkler'
  | 'hydrant'
  | 'hose-reel'
  | 'extinguisher'
  | 'emergency-lighting'
  | 'pump'
  | 'gas'
  | 'passive'
  | 'door'
  | 'electrical'
  | 'structure';

export const SYSTEM_LABELS: Record<SystemKind, string> = {
  detection: 'Fire detection',
  ews: 'Occupant warning / EWIS',
  aspirating: 'Aspirating detection',
  sprinkler: 'Sprinkler',
  hydrant: 'Hydrant',
  'hose-reel': 'Hose reel',
  extinguisher: 'Extinguisher',
  'emergency-lighting': 'Emergency lighting',
  pump: 'Fire pump',
  gas: 'Gas suppression',
  passive: 'Passive fire',
  door: 'Fire door',
  electrical: 'Electrical',
  structure: 'Building structure',
};

// Attribute sets reused across related types.
const CONDITION: AttributeDef = {
  key: 'condition', label: 'Condition', type: 'select',
  options: ['Good', 'Fair', 'Poor', 'Damaged'], summary: true,
};
const ACCESS: AttributeDef = {
  key: 'access', label: 'Access', type: 'select',
  options: ['Clear', 'Restricted', 'Obstructed', 'No access'],
};
const SIGNAGE: AttributeDef = { key: 'signage', label: 'Signage', type: 'select', options: ['Correct', 'Missing', 'Damaged', 'Incorrect'] };

export const ASSET_TYPES: AssetTypeDef[] = [
  // -------------------------------------------------------------- structure
  {
    id: 'level', label: 'Level / floor', system: 'structure', icon: 'layers-outline',
    codePrefix: 'LVL', container: true,
    attributes: [{ key: 'levelName', label: 'Level', type: 'text', summary: true }],
  },
  {
    id: 'room', label: 'Room / area', system: 'structure', icon: 'floor-plan',
    codePrefix: 'RM', container: true,
    attributes: [{ key: 'roomName', label: 'Room', type: 'text', summary: true }],
  },

  // -------------------------------------------------------------- detection
  {
    id: 'fip', label: 'Fire indicator panel', system: 'detection', icon: 'view-dashboard-outline',
    codePrefix: 'FIP', container: true,
    attributes: [
      { key: 'brand', label: 'Brand', type: 'text', summary: true },
      { key: 'panelModel', label: 'Model', type: 'text', summary: true },
      { key: 'firmware', label: 'Firmware', type: 'text' },
      { key: 'loops', label: 'Loops', type: 'number' },
      { key: 'zones', label: 'Zones', type: 'number' },
      { key: 'protocol', label: 'Loop protocol', type: 'text' },
      { key: 'monitoring', label: 'Monitoring provider', type: 'text' },
      { key: 'aseType', label: 'ASE type', type: 'text' },
      CONDITION,
    ],
  },
  {
    id: 'loop', label: 'Detection loop', system: 'detection', icon: 'vector-polyline',
    codePrefix: 'LP', container: true,
    attributes: [
      { key: 'loopNumber', label: 'Loop number', type: 'number', summary: true },
      { key: 'deviceCount', label: 'Devices', type: 'number', summary: true },
      { key: 'loopCurrent', label: 'Loop current', type: 'number', unit: 'mA' },
      { key: 'isolators', label: 'Isolators', type: 'number' },
    ],
  },
  {
    id: 'detector', label: 'Detector', system: 'detection', icon: 'smoke-detector-outline',
    codePrefix: 'DET',
    attributes: [
      { key: 'detectorType', label: 'Type', type: 'select', summary: true,
        options: ['Photoelectric', 'Ionisation', 'Heat', 'Multisensor', 'Beam', 'Duct', 'Flame', 'CO'] },
      { key: 'address', label: 'Address', type: 'text', summary: true },
      { key: 'zone', label: 'Zone', type: 'text', summary: true },
      { key: 'base', label: 'Base model', type: 'text' },
      { key: 'sensitivity', label: 'Sensitivity', type: 'number', unit: '%/m' },
      { key: 'heatRating', label: 'Heat rating', type: 'text' },
      CONDITION, ACCESS,
    ],
  },
  {
    // Distinct from a detector on a panel loop, and not a nicety: a standalone
    // alarm has no panel behind it, is tested by pressing its own button, and
    // is replaced on a date stamped on the unit rather than serviced. In a real
    // register these outnumber loop devices on the residential book of work.
    id: 'smoke-alarm', label: 'Smoke / heat alarm (standalone)', system: 'detection',
    icon: 'smoke-detector-variant', codePrefix: 'ALM',
    attributes: [
      { key: 'alarmType', label: 'Type', type: 'select', summary: true,
        options: ['Photoelectric smoke', 'Ionisation smoke', 'Heat', 'Combination'] },
      { key: 'powerSource', label: 'Power', type: 'select', summary: true,
        options: ['240 V with battery backup', '240 V', '10-year lithium', 'Replaceable battery'] },
      { key: 'interconnected', label: 'Interconnected', type: 'select',
        options: ['Wired', 'Wireless', 'Not interconnected'] },
      { key: 'expiryDate', label: 'Replace by', type: 'date', summary: true },
      CONDITION, ACCESS,
    ],
  },
  {
    id: 'mcp', label: 'Manual call point', system: 'detection', icon: 'gesture-tap-button',
    codePrefix: 'MCP',
    attributes: [
      { key: 'address', label: 'Address', type: 'text', summary: true },
      { key: 'zone', label: 'Zone', type: 'text', summary: true },
      { key: 'resetType', label: 'Reset type', type: 'select', options: ['Key reset', 'Break glass', 'Resettable element'] },
      CONDITION, ACCESS, SIGNAGE,
    ],
  },
  {
    id: 'module', label: 'Interface module', system: 'detection', icon: 'chip',
    codePrefix: 'MOD',
    attributes: [
      { key: 'moduleType', label: 'Type', type: 'select', summary: true, options: ['Input', 'Output', 'I/O', 'Relay', 'Isolator', 'Zone monitor'] },
      { key: 'address', label: 'Address', type: 'text', summary: true },
      { key: 'function', label: 'Function', type: 'text', summary: true },
      { key: 'eol', label: 'EOL fitted', type: 'text' },
      CONDITION,
    ],
  },
  {
    id: 'fip-battery', label: 'Standby battery', system: 'detection', icon: 'car-battery',
    codePrefix: 'BAT',
    attributes: [
      { key: 'voltage', label: 'Voltage', type: 'number', unit: 'V', summary: true },
      { key: 'capacityAh', label: 'Capacity', type: 'number', unit: 'Ah', summary: true },
      { key: 'manufactureDate', label: 'Manufactured', type: 'date' },
      { key: 'terminalVoltage', label: 'Terminal voltage', type: 'number', unit: 'V' },
      { key: 'loadTestResult', label: 'Load test', type: 'text' },
      CONDITION,
    ],
  },

  // -------------------------------------------------------------------- EWS
  {
    id: 'ews-panel', label: 'EWIS / OWS panel', system: 'ews', icon: 'bullhorn-outline',
    codePrefix: 'EWS', container: true,
    attributes: [
      { key: 'brand', label: 'Brand', type: 'text', summary: true },
      { key: 'panelModel', label: 'Model', type: 'text', summary: true },
      { key: 'amplifierW', label: 'Amplifier', type: 'number', unit: 'W' },
      { key: 'speakerCircuits', label: 'Speaker circuits', type: 'number' },
      { key: 'wipLines', label: 'WIP lines', type: 'number' },
      CONDITION,
    ],
  },
  {
    id: 'speaker', label: 'Speaker', system: 'ews', icon: 'speaker',
    codePrefix: 'SPK',
    attributes: [
      { key: 'circuit', label: 'Circuit', type: 'text', summary: true },
      { key: 'wattage', label: 'Tapping', type: 'number', unit: 'W' },
      { key: 'spl', label: 'Measured SPL', type: 'number', unit: 'dB(A)', summary: true },
      CONDITION,
    ],
  },
  {
    id: 'strobe', label: 'Visual alarm device', system: 'ews', icon: 'flash-outline',
    codePrefix: 'VAD',
    attributes: [
      { key: 'mounting', label: 'Mounting', type: 'select', options: ['Wall', 'Ceiling'] },
      { key: 'colour', label: 'Colour', type: 'text' },
      CONDITION,
    ],
  },
  {
    id: 'wip', label: 'Warden intercom phone', system: 'ews', icon: 'phone-classic',
    codePrefix: 'WIP',
    attributes: [
      { key: 'line', label: 'Line', type: 'text', summary: true },
      { key: 'callTest', label: 'Call test', type: 'select', options: ['Pass', 'Fail'] },
      CONDITION, ACCESS,
    ],
  },

  // ------------------------------------------------------------- aspirating
  {
    id: 'asd', label: 'Aspirating detector', system: 'aspirating', icon: 'air-filter',
    codePrefix: 'ASD', container: true,
    attributes: [
      { key: 'asdModel', label: 'Model', type: 'text', summary: true },
      { key: 'aspiratorSetting', label: 'Aspirator setting', type: 'number', summary: true },
      { key: 'airflow', label: 'Airflow', type: 'number', unit: '%' },
      { key: 'smokeLevel', label: 'Smoke level', type: 'number', unit: '%obs/m' },
      { key: 'filterChanged', label: 'Filter changed', type: 'date' },
      { key: 'alertThreshold', label: 'Alert threshold', type: 'number', unit: '%obs/m' },
      { key: 'fire1Threshold', label: 'Fire 1 threshold', type: 'number', unit: '%obs/m' },
      CONDITION,
    ],
  },
  {
    id: 'sampling-point', label: 'Sampling point', system: 'aspirating', icon: 'circle-small',
    codePrefix: 'SP',
    attributes: [
      { key: 'pipeRun', label: 'Pipe run', type: 'text', summary: true },
      { key: 'holeDiameter', label: 'Hole diameter', type: 'number', unit: 'mm' },
      { key: 'transportTime', label: 'Transport time', type: 'number', unit: 's', summary: true },
    ],
  },

  // -------------------------------------------------------------- sprinkler
  {
    id: 'sprinkler-head', label: 'Sprinkler head', system: 'sprinkler', icon: 'sprinkler-variant',
    codePrefix: 'SPR',
    attributes: [
      { key: 'kFactor', label: 'K factor', type: 'number', summary: true },
      { key: 'temperature', label: 'Temperature rating', type: 'number', unit: '°C', summary: true },
      { key: 'orientation', label: 'Orientation', type: 'select', options: ['Pendent', 'Upright', 'Sidewall', 'Concealed', 'Flush'] },
      { key: 'response', label: 'Response', type: 'select', options: ['Standard', 'Quick', 'Special'] },
      { key: 'finish', label: 'Finish', type: 'text' },
      { key: 'obstruction', label: 'Obstruction', type: 'select', options: ['None', 'Partial', 'Significant'] },
      { key: 'corrosion', label: 'Corrosion', type: 'select', options: ['None', 'Light', 'Heavy'] },
      CONDITION,
    ],
  },
  {
    id: 'sprinkler-valve', label: 'Sprinkler valve set', system: 'sprinkler', icon: 'valve',
    codePrefix: 'SVS', container: true,
    attributes: [
      { key: 'valveType', label: 'Type', type: 'select', summary: true, options: ['Alarm valve', 'Dry pipe', 'Deluge', 'Pre-action', 'Control valve'] },
      { key: 'size', label: 'Size', type: 'text' },
      { key: 'staticPressure', label: 'Static pressure', type: 'number', unit: 'kPa', summary: true },
      { key: 'runningPressure', label: 'Running pressure', type: 'number', unit: 'kPa' },
      { key: 'monitored', label: 'Tamper monitored', type: 'boolean' },
      { key: 'locked', label: 'Locked open', type: 'boolean' },
      CONDITION,
    ],
  },
  {
    id: 'flow-switch', label: 'Flow switch', system: 'sprinkler', icon: 'waves-arrow-right',
    codePrefix: 'FSW',
    attributes: [
      { key: 'zone', label: 'Zone', type: 'text', summary: true },
      { key: 'delaySeconds', label: 'Delay', type: 'number', unit: 's' },
      CONDITION,
    ],
  },

  // ---------------------------------------------------------------- hydrant
  {
    id: 'hydrant', label: 'Fire hydrant', system: 'hydrant', icon: 'fire-hydrant',
    codePrefix: 'HYD',
    attributes: [
      { key: 'hydrantType', label: 'Type', type: 'select', summary: true, options: ['Internal', 'External', 'Booster', 'Feed'] },
      { key: 'outletSize', label: 'Outlet size', type: 'text' },
      { key: 'staticPressure', label: 'Static pressure', type: 'number', unit: 'kPa', summary: true },
      { key: 'runningPressure', label: 'Running pressure', type: 'number', unit: 'kPa' },
      { key: 'flow', label: 'Flow', type: 'number', unit: 'L/s' },
      { key: 'capsFitted', label: 'Caps fitted', type: 'boolean' },
      CONDITION, ACCESS, SIGNAGE,
    ],
  },
  {
    id: 'booster', label: 'Booster assembly', system: 'hydrant', icon: 'connection',
    codePrefix: 'BST',
    attributes: [
      { key: 'inlets', label: 'Inlets', type: 'number', summary: true },
      { key: 'boosterType', label: 'Type', type: 'select', options: ['Hydrant', 'Sprinkler', 'Combined'] },
      CONDITION, ACCESS, SIGNAGE,
    ],
  },

  // -------------------------------------------------------------- hose reel
  {
    id: 'hose-reel', label: 'Fire hose reel', system: 'hose-reel', icon: 'hoop-house',
    codePrefix: 'FHR',
    attributes: [
      { key: 'hoseLength', label: 'Hose length', type: 'number', unit: 'm', summary: true },
      { key: 'nozzleType', label: 'Nozzle', type: 'text' },
      { key: 'flow', label: 'Flow', type: 'number', unit: 'L/min', summary: true },
      { key: 'pressure', label: 'Pressure', type: 'number', unit: 'kPa' },
      CONDITION, ACCESS, SIGNAGE,
    ],
  },

  // ----------------------------------------------------------- extinguisher
  {
    id: 'extinguisher', label: 'Fire extinguisher', system: 'extinguisher', icon: 'fire-extinguisher',
    codePrefix: 'EXT',
    attributes: [
      { key: 'agent', label: 'Type', type: 'select', summary: true,
        options: ['ABE dry chemical', 'BE dry chemical', 'CO2', 'Water', 'Foam', 'Wet chemical', 'Special'] },
      { key: 'capacity', label: 'Capacity', type: 'text', summary: true },
      { key: 'rating', label: 'Rating', type: 'text' },
      { key: 'manufactureDate', label: 'Manufactured', type: 'date' },
      { key: 'lastPressureTest', label: 'Last pressure test', type: 'date' },
      { key: 'nextPressureTest', label: 'Next pressure test', type: 'date', summary: true },
      { key: 'bracket', label: 'Bracket', type: 'select', options: ['Correct', 'Missing', 'Damaged'] },
      { key: 'gaugeReading', label: 'Gauge', type: 'select', options: ['In range', 'Low', 'High', 'No gauge'] },
      CONDITION, ACCESS, SIGNAGE,
    ],
  },
  {
    id: 'fire-blanket', label: 'Fire blanket', system: 'extinguisher', icon: 'square-outline',
    codePrefix: 'FBL',
    attributes: [
      { key: 'size', label: 'Size', type: 'text', summary: true },
      CONDITION, ACCESS, SIGNAGE,
    ],
  },

  // ------------------------------------------------------ emergency lighting
  {
    id: 'emergency-light', label: 'Emergency light', system: 'emergency-lighting', icon: 'lightbulb-on-outline',
    codePrefix: 'EEL',
    attributes: [
      { key: 'fittingType', label: 'Type', type: 'select', summary: true, options: ['Emergency', 'Exit sign', 'Combined'] },
      { key: 'operation', label: 'Operation', type: 'select', options: ['Maintained', 'Non-maintained', 'Sustained'] },
      { key: 'circuit', label: 'Circuit', type: 'text' },
      { key: 'batteryType', label: 'Battery', type: 'text' },
      { key: 'durationMinutes', label: 'Discharge duration', type: 'number', unit: 'min', summary: true },
      { key: 'illuminance', label: 'Illuminance', type: 'number', unit: 'lux' },
      CONDITION,
    ],
  },

  // ------------------------------------------------------------------- pump
  {
    id: 'fire-pump', label: 'Fire pump', system: 'pump', icon: 'pump',
    codePrefix: 'PMP', container: true,
    attributes: [
      { key: 'pumpType', label: 'Type', type: 'select', summary: true, options: ['Electric', 'Diesel', 'Jockey'] },
      { key: 'ratedFlow', label: 'Rated flow', type: 'number', unit: 'L/s', summary: true },
      { key: 'ratedPressure', label: 'Rated pressure', type: 'number', unit: 'kPa' },
      { key: 'startPressure', label: 'Start pressure', type: 'number', unit: 'kPa' },
      { key: 'stopPressure', label: 'Stop pressure', type: 'number', unit: 'kPa' },
      { key: 'churnPressure', label: 'Churn pressure', type: 'number', unit: 'kPa' },
      { key: 'runHours', label: 'Run hours', type: 'number', unit: 'h' },
      CONDITION,
    ],
  },
  {
    id: 'pump-controller', label: 'Pump controller', system: 'pump', icon: 'view-dashboard-variant-outline',
    codePrefix: 'PCT',
    attributes: [
      { key: 'brand', label: 'Brand', type: 'text', summary: true },
      { key: 'controllerModel', label: 'Model', type: 'text' },
      { key: 'autoMode', label: 'In auto', type: 'boolean', summary: true },
      CONDITION,
    ],
  },
  {
    id: 'water-tank', label: 'Water storage tank', system: 'pump', icon: 'water-outline',
    codePrefix: 'TNK',
    attributes: [
      { key: 'capacity', label: 'Capacity', type: 'number', unit: 'L', summary: true },
      { key: 'level', label: 'Level', type: 'number', unit: '%', summary: true },
      { key: 'lowLevelAlarm', label: 'Low level alarm', type: 'boolean' },
      CONDITION,
    ],
  },

  // -------------------------------------------------------------------- gas
  {
    id: 'gas-cylinder', label: 'Suppression cylinder', system: 'gas', icon: 'gas-cylinder',
    codePrefix: 'CYL',
    attributes: [
      { key: 'agent', label: 'Agent', type: 'select', summary: true, options: ['FM-200', 'Novec 1230', 'Inergen', 'Argonite', 'CO2', 'Other'] },
      { key: 'chargeWeight', label: 'Charge weight', type: 'number', unit: 'kg', summary: true },
      { key: 'measuredWeight', label: 'Measured weight', type: 'number', unit: 'kg' },
      { key: 'pressure', label: 'Pressure', type: 'number', unit: 'kPa' },
      { key: 'lastHydro', label: 'Last hydro test', type: 'date' },
      CONDITION,
    ],
  },

  // ---------------------------------------------------------------- passive
  {
    id: 'penetration', label: 'Fire-rated penetration', system: 'passive', icon: 'circle-double',
    codePrefix: 'PEN',
    attributes: [
      { key: 'barrier', label: 'Barrier', type: 'select', summary: true, options: ['Wall', 'Floor', 'Ceiling', 'Shaft'] },
      { key: 'service', label: 'Service', type: 'select', options: ['Electrical', 'Hydraulic', 'Mechanical', 'Comms', 'Mixed'] },
      { key: 'frl', label: 'FRL', type: 'text', summary: true },
      { key: 'sealSystem', label: 'Seal system', type: 'text' },
      { key: 'sealManufacturer', label: 'Seal manufacturer', type: 'text' },
      { key: 'tagged', label: 'Tagged', type: 'boolean' },
      CONDITION,
    ],
  },
  {
    id: 'fire-damper', label: 'Fire damper', system: 'passive', icon: 'air-conditioner',
    codePrefix: 'DMP',
    attributes: [
      { key: 'damperType', label: 'Type', type: 'select', options: ['Fire', 'Smoke', 'Combination'] },
      { key: 'frl', label: 'FRL', type: 'text' },
      { key: 'actuation', label: 'Actuation', type: 'select', options: ['Fusible link', 'Motorised', 'Spring return'] },
      CONDITION, ACCESS,
    ],
  },

  // ------------------------------------------------------------------- door
  {
    id: 'fire-door', label: 'Fire door', system: 'door', icon: 'door-closed',
    codePrefix: 'FD',
    attributes: [
      { key: 'frl', label: 'FRL', type: 'text', summary: true },
      { key: 'leaves', label: 'Leaves', type: 'number' },
      { key: 'closer', label: 'Closer', type: 'select', options: ['Correct', 'Missing', 'Faulty'] },
      { key: 'hinges', label: 'Hinges', type: 'select', options: ['Correct', 'Damaged', 'Missing'] },
      { key: 'seals', label: 'Seals', type: 'select', options: ['Intact', 'Damaged', 'Missing'] },
      { key: 'gapTop', label: 'Gap — top', type: 'number', unit: 'mm' },
      { key: 'gapSide', label: 'Gap — side', type: 'number', unit: 'mm' },
      { key: 'gapBottom', label: 'Gap — bottom', type: 'number', unit: 'mm' },
      { key: 'latching', label: 'Latches correctly', type: 'boolean', summary: true },
      { key: 'heldOpen', label: 'Held open device', type: 'boolean' },
      CONDITION, SIGNAGE,
    ],
  },

  // ------------------------------------------------------------- electrical
  {
    id: 'switchboard', label: 'Switchboard', system: 'electrical', icon: 'electric-switch',
    codePrefix: 'SWB', container: true,
    attributes: [
      { key: 'boardName', label: 'Board', type: 'text', summary: true },
      { key: 'supply', label: 'Supply', type: 'select', options: ['Mains', 'Generator', 'UPS', 'Solar', 'Multiple'] },
      { key: 'mainSwitchRating', label: 'Main switch', type: 'number', unit: 'A' },
      { key: 'essentialServices', label: 'Essential services board', type: 'boolean' },
      CONDITION,
    ],
  },
  {
    id: 'rcd', label: 'RCD', system: 'electrical', icon: 'electric-switch-closed',
    codePrefix: 'RCD',
    attributes: [
      { key: 'circuit', label: 'Circuit', type: 'text', summary: true },
      { key: 'ratingMa', label: 'Rating', type: 'number', unit: 'mA' },
      { key: 'tripTimeMs', label: 'Trip time', type: 'number', unit: 'ms', summary: true },
      { key: 'tripCurrentMa', label: 'Trip current', type: 'number', unit: 'mA' },
    ],
  },
];

export function assetTypeById(id: string): AssetTypeDef | undefined {
  return ASSET_TYPES.find((t) => t.id === id);
}

export function assetTypesForSystem(system: SystemKind): AssetTypeDef[] {
  return ASSET_TYPES.filter((t) => t.system === system);
}

/** Systems that actually have asset types defined, in display order. */
export function activeSystems(): SystemKind[] {
  const order: SystemKind[] = [
    'detection', 'ews', 'aspirating', 'sprinkler', 'hydrant', 'hose-reel',
    'extinguisher', 'emergency-lighting', 'pump', 'gas', 'passive', 'door',
    'electrical', 'structure',
  ];
  return order.filter((s) => ASSET_TYPES.some((t) => t.system === s));
}
