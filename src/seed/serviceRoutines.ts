import type { SystemKind } from './assetTypes';

/**
 * Routine service definitions.
 *
 * These describe the *structure* of a routine service — what gets looked at,
 * what counts as a pass, what evidence to keep — written in our own words from
 * the requirements. They deliberately do not reproduce the text of any
 * standard, which is copyright Standards Australia and has to be held under
 * licence. Where a check exists because a standard requires it, the entry says
 * so and names the standard; where it exists because a manufacturer or Safe QLD
 * requires it, it says that instead. The app never blurs the three.
 *
 * Anything marked `verify: true` is a point where the current standard, the
 * panel manual or the site's baseline data governs and should be consulted
 * rather than trusted from here.
 */

export type Frequency = 'monthly' | 'quarterly' | 'six-monthly' | 'annual' | 'five-yearly' | 'commissioning';

export type SourceKind = 'standard' | 'manufacturer' | 'qdc' | 'ncc' | 'legislation' | 'internal';

export const SOURCE_LABEL: Record<SourceKind, string> = {
  standard: 'Australian Standard',
  manufacturer: 'Manufacturer requirement',
  qdc: 'Queensland Development Code',
  ncc: 'National Construction Code',
  legislation: 'Legislation',
  internal: 'Safe QLD procedure',
};

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  'six-monthly': 'Six-monthly',
  annual: 'Annual',
  'five-yearly': 'Five-yearly',
  commissioning: 'Commissioning',
};

export interface TestDef {
  id: string;
  section: string;
  label: string;
  /** The action to take. */
  whatToDo?: string;
  /** What to be looking at while doing it. */
  whatToLookFor?: string;
  passCriteria?: string;
  failCriteria?: string;
  photoRequired?: boolean;
  /** Name of the value to record, where the result is a measurement not a verdict. */
  measurementKey?: string;
  measurementUnit?: string;
  /** Defect code raised automatically when this fails. */
  defectCode?: string;
  sourceKind: SourceKind;
  sourceRef?: string;
  /** Applies to assets of this type; omitted means it is a system-level check. */
  assetTypeId?: string;
  /** True where the specific figure or interval must come from the standard or manual. */
  verify?: boolean;
}

export interface ServiceRoutine {
  id: string;
  label: string;
  system: SystemKind;
  frequency: Frequency;
  description: string;
  sourceKind: SourceKind;
  sourceRef?: string;
  tests: TestDef[];
}

export const SERVICE_ROUTINES: ServiceRoutine[] = [
  // ---------------------------------------------------------------- detection
  {
    id: 'det-monthly',
    label: 'Fire detection — monthly',
    system: 'detection',
    frequency: 'monthly',
    description: 'Panel condition, indication and power supply check. No device testing at this frequency.',
    sourceKind: 'standard',
    sourceRef: 'AS 1851 — routine service of fire detection and alarm systems',
    tests: [
      {
        id: 'det-m-01', section: 'Panel', label: 'Panel indicates normal',
        whatToDo: 'Read the panel display and indicators.',
        whatToLookFor: 'Any alarm, fault, isolate or disable condition showing.',
        passCriteria: 'Panel shows system normal with no unresolved conditions.',
        failCriteria: 'Any fault, isolate or disable present without a current impairment record.',
        defectCode: 'DET-FIP-001', sourceKind: 'standard', photoRequired: true,
      },
      {
        id: 'det-m-02', section: 'Panel', label: 'No devices left isolated',
        whatToDo: 'Check the isolate and disable lists at the panel.',
        passCriteria: 'Nothing isolated, or every isolation has a current impairment record.',
        failCriteria: 'Devices isolated with no record of why.',
        defectCode: 'DET-FIP-005', sourceKind: 'standard',
      },
      {
        id: 'det-m-03', section: 'Power', label: 'Mains supply healthy',
        whatToDo: 'Confirm the mains supply indicator and that the supply is not switched off.',
        passCriteria: 'Mains present and the supply is secure against inadvertent switching.',
        defectCode: 'DET-PWR-001', sourceKind: 'standard',
      },
      {
        id: 'det-m-04', section: 'Power', label: 'Battery terminal voltage',
        whatToDo: 'Measure across the battery terminals with the panel on mains.',
        measurementKey: 'Battery terminal voltage', measurementUnit: 'V',
        passCriteria: 'Within the charger float range given by the panel manufacturer.',
        defectCode: 'DET-BAT-004', sourceKind: 'manufacturer', verify: true,
      },
      {
        id: 'det-m-05', section: 'Alarm', label: 'Alarm signalling equipment path',
        whatToDo: 'Confirm the brigade signalling path is connected and not isolated at the panel or the monitoring end.',
        passCriteria: 'Signalling path in service.',
        defectCode: 'DET-ASE-001', sourceKind: 'standard',
      },
      {
        id: 'det-m-06', section: 'Access', label: 'Panel access and zone chart',
        whatToLookFor: 'Panel accessible, zone chart present and legible, block plan current.',
        failCriteria: 'Chart missing, illegible or not matching the installed zones.',
        defectCode: 'DET-FIP-004', sourceKind: 'standard',
      },
    ],
  },
  {
    id: 'det-annual',
    label: 'Fire detection — annual',
    system: 'detection',
    frequency: 'annual',
    description: 'Every initiating device tested by its approved method, alarm functions verified end to end, battery capacity assessed.',
    sourceKind: 'standard',
    sourceRef: 'AS 1851 — routine service of fire detection and alarm systems',
    tests: [
      {
        id: 'det-a-01', section: 'Devices', label: 'Detector alarms on test', assetTypeId: 'detector',
        whatToDo: 'Apply the approved test method for the detector type — aerosol for smoke, heat source for thermal, obscuration for beam.',
        whatToLookFor: 'Device alarms, the correct address and zone report at the panel, and the indicator operates.',
        passCriteria: 'Alarm reported at the panel against the correct zone and point text.',
        failCriteria: 'No alarm, wrong zone reported, or the device does not reset.',
        defectCode: 'DET-DET-001', sourceKind: 'standard',
      },
      {
        id: 'det-a-02', section: 'Devices', label: 'Detector condition', assetTypeId: 'detector',
        whatToLookFor: 'Contamination, paint, physical damage, obstruction, and whether the type still suits the environment.',
        failCriteria: 'Contaminated, painted, damaged or obstructed.',
        defectCode: 'DET-DET-002', sourceKind: 'standard', photoRequired: true,
      },
      {
        id: 'det-a-03', section: 'Devices', label: 'Call point operates', assetTypeId: 'mcp',
        whatToDo: 'Operate the call point with the approved test key or element.',
        passCriteria: 'Alarm reported at the panel against the correct zone.',
        defectCode: 'DET-MCP-001', sourceKind: 'standard',
      },
      {
        id: 'det-a-04', section: 'Devices', label: 'Interface module operates', assetTypeId: 'module',
        whatToDo: 'Operate the input or command the output and confirm the associated function.',
        passCriteria: 'The intended plant response occurs and reports correctly.',
        defectCode: 'DET-MOD-001', sourceKind: 'standard',
      },
      {
        id: 'det-a-05', section: 'Power', label: 'Battery capacity assessed',
        whatToDo: 'Recalculate the required capacity from measured quiescent and alarm currents, and compare against the battery fitted.',
        measurementKey: 'Quiescent current', measurementUnit: 'A',
        passCriteria: 'Installed capacity at least the calculated requirement.',
        defectCode: 'DET-BAT-002', sourceKind: 'standard',
      },
      {
        id: 'det-a-06', section: 'Power', label: 'Battery discharge test',
        whatToDo: 'Discharge at the rate and for the duration required, watching terminal voltage.',
        whatToLookFor: 'Terminal voltage falling below the permitted minimum before time elapses.',
        measurementKey: 'Final terminal voltage', measurementUnit: 'V',
        defectCode: 'DET-BAT-001', sourceKind: 'standard', verify: true,
      },
      {
        id: 'det-a-07', section: 'Alarm', label: 'Brigade signalling verified',
        whatToDo: 'With the monitoring provider on the line, initiate an alarm and confirm receipt.',
        passCriteria: 'Alarm received and identified correctly by the monitoring provider.',
        defectCode: 'DET-ASE-002', sourceKind: 'standard',
      },
      {
        id: 'det-a-08', section: 'Alarm', label: 'Ancillary functions operate',
        whatToDo: 'Verify each ancillary output against the cause and effect matrix — plant shutdown, door release, lift homing, damper operation.',
        passCriteria: 'Every effect operates as documented, within its stated delay.',
        defectCode: 'DET-MOD-001', sourceKind: 'standard',
      },
      {
        id: 'det-a-09', section: 'Records', label: 'Zone text matches reality',
        whatToDo: 'Compare panel zone and point text against the actual device locations found during testing.',
        failCriteria: 'Text does not describe where the devices actually are.',
        defectCode: 'DET-FIP-004', sourceKind: 'standard',
      },
    ],
  },

  // -------------------------------------------------------------------- EWIS
  {
    id: 'ews-annual',
    label: 'Occupant warning — annual',
    system: 'ews',
    frequency: 'annual',
    description: 'Alarm tones and messages verified throughout, audibility measured, warden facilities tested.',
    sourceKind: 'standard',
    sourceRef: 'AS 1851 with AS 1670.4 for the system requirements',
    tests: [
      {
        id: 'ews-a-01', section: 'Alarm', label: 'Alert and evacuation signals sound',
        whatToDo: 'Operate the system and listen through every occupied area.',
        passCriteria: 'Correct signal audible throughout, in every zone it should reach.',
        defectCode: 'EWS-SPK-001', sourceKind: 'standard',
      },
      {
        id: 'ews-a-02', section: 'Alarm', label: 'Sound pressure level',
        whatToDo: 'Measure sound pressure level in the areas served, at the positions used at commissioning.',
        measurementKey: 'Sound pressure level', measurementUnit: 'dB(A)',
        passCriteria: 'At or above the level required, and above ambient by the required margin.',
        defectCode: 'EWS-SPK-002', sourceKind: 'standard', verify: true,
      },
      {
        id: 'ews-a-03', section: 'Circuits', label: 'Speaker circuit impedance',
        whatToDo: 'Measure each speaker circuit and compare against the baseline figure.',
        measurementKey: 'Circuit impedance', measurementUnit: 'Ω',
        passCriteria: 'Within tolerance of the baseline value recorded at commissioning.',
        defectCode: 'EWS-CCT-001', sourceKind: 'standard',
      },
      {
        id: 'ews-a-04', section: 'Warden facilities', label: 'Warden intercom phones', assetTypeId: 'wip',
        whatToDo: 'Call each handset from the master and answer from each handset.',
        passCriteria: 'Two-way speech on every line.',
        defectCode: 'EWS-WIP-001', sourceKind: 'standard',
      },
      {
        id: 'ews-a-05', section: 'Warden facilities', label: 'Microphone broadcast',
        whatToDo: 'Broadcast from the master microphone to each zone in turn and to all zones.',
        passCriteria: 'Speech intelligible in every zone selected.',
        defectCode: 'EWS-PNL-001', sourceKind: 'standard',
      },
      {
        id: 'ews-a-06', section: 'Visual', label: 'Visual alarm devices operate', assetTypeId: 'strobe',
        passCriteria: 'Every device operates on alarm.',
        defectCode: 'EWS-VAD-001', sourceKind: 'standard',
      },
    ],
  },

  // ------------------------------------------------------- emergency lighting
  {
    id: 'eel-six-monthly',
    label: 'Emergency lighting — six-monthly',
    system: 'emergency-lighting',
    frequency: 'six-monthly',
    description: 'Discharge test of every fitting for the full required duration, with condition and illumination checks.',
    sourceKind: 'standard',
    sourceRef: 'AS 1851 with AS 2293 for the system requirements',
    tests: [
      {
        id: 'eel-s-01', section: 'Fittings', label: 'Discharge test', assetTypeId: 'emergency-light',
        whatToDo: 'Initiate the discharge test and confirm the fitting stays illuminated for the full required period.',
        measurementKey: 'Duration achieved', measurementUnit: 'min',
        passCriteria: 'Illuminated for the full required duration.',
        failCriteria: 'Extinguishes early, or does not illuminate at all.',
        defectCode: 'EEL-FIT-001', sourceKind: 'standard', verify: true,
      },
      {
        id: 'eel-s-02', section: 'Fittings', label: 'Charge indicator', assetTypeId: 'emergency-light',
        whatToLookFor: 'Charge indicator lit after the test period.',
        defectCode: 'EEL-FIT-003', sourceKind: 'standard',
      },
      {
        id: 'eel-s-03', section: 'Exit signs', label: 'Exit signs illuminated and correct',
        whatToLookFor: 'Sign illuminated, legible, unobscured, and the directional legend pointing to the actual path of travel.',
        defectCode: 'EEL-EXT-001', sourceKind: 'standard', photoRequired: true,
      },
      {
        id: 'eel-s-04', section: 'Condition', label: 'Fitting condition', assetTypeId: 'emergency-light',
        whatToLookFor: 'Damaged or missing diffusers, discoloured lenses, physical damage.',
        defectCode: 'EEL-FIT-004', sourceKind: 'standard',
      },
    ],
  },

  // -------------------------------------------------------------- extinguisher
  {
    id: 'ext-six-monthly',
    label: 'Extinguishers — six-monthly',
    system: 'extinguisher',
    frequency: 'six-monthly',
    description: 'Presence, accessibility, condition, pressure and tagging of every extinguisher and blanket.',
    sourceKind: 'standard',
    sourceRef: 'AS 1851 — routine service of portable fire equipment',
    tests: [
      {
        id: 'ext-s-01', section: 'Presence', label: 'Present and correctly located', assetTypeId: 'extinguisher',
        whatToLookFor: 'Extinguisher present at its recorded location, on its bracket, with signage visible from the approach.',
        defectCode: 'EXT-EXT-002', sourceKind: 'standard',
      },
      {
        id: 'ext-s-02', section: 'Access', label: 'Accessible and unobstructed', assetTypeId: 'extinguisher',
        defectCode: 'EXT-EXT-004', sourceKind: 'standard', photoRequired: true,
      },
      {
        id: 'ext-s-03', section: 'Condition', label: 'Pressure within range', assetTypeId: 'extinguisher',
        whatToDo: 'Read the gauge, or weigh where the type has no gauge.',
        // Two different measurements depending on the extinguisher: a gauged
        // unit gives a pressure, a CO2 unit is weighed. Naming both beats an
        // unlabelled number that nobody can interpret a year later.
        measurementKey: 'Gauge reading or mass', measurementUnit: 'kPa or kg',
        defectCode: 'EXT-EXT-001', sourceKind: 'standard',
      },
      {
        id: 'ext-s-04', section: 'Condition', label: 'Cylinder, hose and horn condition', assetTypeId: 'extinguisher',
        whatToLookFor: 'Corrosion, dents, damaged hose or horn, missing pin or tamper seal.',
        defectCode: 'EXT-EXT-005', sourceKind: 'standard',
      },
      {
        id: 'ext-s-05', section: 'Records', label: 'Pressure test date current', assetTypeId: 'extinguisher',
        whatToDo: 'Check the date on the cylinder against the required test interval for its type.',
        defectCode: 'EXT-EXT-003', sourceKind: 'standard', verify: true,
      },
    ],
  },

  // ----------------------------------------------------------------- hose reel
  {
    id: 'fhr-six-monthly',
    label: 'Hose reels — six-monthly',
    system: 'hose-reel',
    frequency: 'six-monthly',
    description: 'Flow test, hose and nozzle condition, accessibility and signage.',
    sourceKind: 'standard',
    sourceRef: 'AS 1851 with AS 2441 for the system requirements',
    tests: [
      {
        id: 'fhr-s-01', section: 'Flow', label: 'Flow at the nozzle', assetTypeId: 'hose-reel',
        whatToDo: 'Run the hose out fully and measure flow at the nozzle.',
        measurementKey: 'Flow', measurementUnit: 'L/min',
        passCriteria: 'At or above the required minimum flow.',
        defectCode: 'FHR-REL-001', sourceKind: 'standard', verify: true,
      },
      {
        id: 'fhr-s-02', section: 'Condition', label: 'Hose condition', assetTypeId: 'hose-reel',
        whatToLookFor: 'Perishing, splits, kinks, and that the full length runs out and rewinds.',
        defectCode: 'FHR-HOS-001', sourceKind: 'standard',
      },
      {
        id: 'fhr-s-03', section: 'Condition', label: 'Nozzle and shut-off', assetTypeId: 'hose-reel',
        defectCode: 'FHR-NOZ-001', sourceKind: 'standard',
      },
      {
        id: 'fhr-s-04', section: 'Access', label: 'Accessible and signed', assetTypeId: 'hose-reel',
        defectCode: 'FHR-REL-002', sourceKind: 'standard',
      },
    ],
  },

  // ------------------------------------------------------------------- hydrant
  {
    id: 'hyd-annual',
    label: 'Hydrants — annual',
    system: 'hydrant',
    frequency: 'annual',
    description: 'Flow and pressure at the hydraulically most disadvantaged hydrant, valve operation, booster condition and access.',
    sourceKind: 'standard',
    sourceRef: 'AS 1851 with AS 2419 for the system requirements',
    tests: [
      {
        id: 'hyd-a-01', section: 'Performance', label: 'Static and running pressure', assetTypeId: 'hydrant',
        whatToDo: 'Measure static pressure, then running pressure and flow at the required test point.',
        measurementKey: 'Running pressure', measurementUnit: 'kPa',
        passCriteria: 'At or above the pressure and flow required for the installation.',
        defectCode: 'HYD-HYD-001', sourceKind: 'standard', verify: true,
      },
      {
        id: 'hyd-a-02', section: 'Valves', label: 'Valve operates and seals', assetTypeId: 'hydrant',
        whatToDo: 'Operate through full travel and confirm it seals when closed.',
        defectCode: 'HYD-HYD-002', sourceKind: 'standard',
      },
      {
        id: 'hyd-a-03', section: 'Condition', label: 'Caps, blanks and couplings', assetTypeId: 'hydrant',
        defectCode: 'HYD-HYD-003', sourceKind: 'standard',
      },
      {
        id: 'hyd-a-04', section: 'Booster', label: 'Booster accessible and correct', assetTypeId: 'booster',
        whatToLookFor: 'Unimpeded brigade access, correct signage, couplings in good order, cabinet secure but openable.',
        defectCode: 'HYD-BST-001', sourceKind: 'standard', photoRequired: true,
      },
    ],
  },

  // ----------------------------------------------------------------- sprinkler
  {
    id: 'spr-annual',
    label: 'Sprinkler — annual',
    system: 'sprinkler',
    frequency: 'annual',
    description: 'Alarm valve and flow switch operation, head condition and obstruction survey, valve positions and monitoring.',
    sourceKind: 'standard',
    sourceRef: 'AS 1851 with AS 2118 for the system requirements',
    tests: [
      {
        id: 'spr-a-01', section: 'Alarm', label: 'Flow switch signals', assetTypeId: 'flow-switch',
        whatToDo: 'Open the test valve and confirm alarm at the panel within the set delay.',
        measurementKey: 'Time to alarm', measurementUnit: 's',
        defectCode: 'SPR-FSW-001', sourceKind: 'standard',
      },
      {
        id: 'spr-a-02', section: 'Valves', label: 'Control valves open and secured', assetTypeId: 'sprinkler-valve',
        whatToLookFor: 'Every control valve fully open, locked or strapped, and tamper monitored.',
        defectCode: 'SPR-VLV-001', sourceKind: 'standard', photoRequired: true,
      },
      {
        id: 'spr-a-03', section: 'Valves', label: 'Tamper monitoring signals', assetTypeId: 'sprinkler-valve',
        whatToDo: 'Operate each tamper switch and confirm the signal at the panel.',
        defectCode: 'SPR-VLV-002', sourceKind: 'standard',
      },
      {
        id: 'spr-a-04', section: 'Heads', label: 'Head condition and obstruction', assetTypeId: 'sprinkler-head',
        whatToLookFor: 'Paint, corrosion, damage, loading, and stock or partitions obstructing the spray pattern.',
        defectCode: 'SPR-HD-002', sourceKind: 'standard', photoRequired: true,
      },
      {
        id: 'spr-a-05', section: 'Pressure', label: 'Static and running pressures', assetTypeId: 'sprinkler-valve',
        measurementKey: 'Static pressure', measurementUnit: 'kPa',
        passCriteria: 'Consistent with the baseline recorded at commissioning.',
        defectCode: 'SPR-SUP-001', sourceKind: 'standard',
      },
    ],
  },

  // ---------------------------------------------------------------------- pump
  {
    id: 'pmp-monthly',
    label: 'Fire pump — monthly',
    system: 'pump',
    frequency: 'monthly',
    description: 'Automatic start test, pressure readings, controller state and tank level.',
    sourceKind: 'standard',
    sourceRef: 'AS 1851 with AS 2941 for the system requirements',
    tests: [
      {
        id: 'pmp-m-01', section: 'Start', label: 'Automatic start on pressure drop', assetTypeId: 'fire-pump',
        whatToDo: 'Bleed pressure through the test line until the pump starts on its own.',
        measurementKey: 'Start pressure', measurementUnit: 'kPa',
        passCriteria: 'Pump starts automatically at the set pressure.',
        defectCode: 'PMP-PMP-001', sourceKind: 'standard',
      },
      {
        id: 'pmp-m-02', section: 'Performance', label: 'Churn pressure', assetTypeId: 'fire-pump',
        measurementKey: 'Churn pressure', measurementUnit: 'kPa',
        passCriteria: 'Consistent with the commissioned figure.',
        defectCode: 'PMP-PMP-002', sourceKind: 'standard',
      },
      {
        id: 'pmp-m-03', section: 'Controller', label: 'Controller in automatic', assetTypeId: 'pump-controller',
        whatToLookFor: 'Selector in auto, no alarms, indicators healthy.',
        defectCode: 'PMP-PMP-003', sourceKind: 'standard', photoRequired: true,
      },
      {
        id: 'pmp-m-04', section: 'Supply', label: 'Tank level and low level alarm', assetTypeId: 'water-tank',
        measurementKey: 'Tank level', measurementUnit: '%',
        defectCode: 'PMP-TNK-001', sourceKind: 'standard',
      },
      {
        id: 'pmp-m-05', section: 'Diesel', label: 'Starting batteries', assetTypeId: 'fire-pump',
        whatToDo: 'On diesel sets, confirm both starting circuits crank the engine and check battery condition.',
        defectCode: 'PMP-DSL-001', sourceKind: 'standard',
      },
    ],
  },

  // --------------------------------------------------------------- aspirating
  {
    id: 'asd-six-monthly',
    label: 'Aspirating detection — six-monthly',
    system: 'aspirating',
    frequency: 'six-monthly',
    description: 'Airflow, filter condition, smoke test at the sampling points and alarm threshold verification.',
    sourceKind: 'standard',
    sourceRef: 'AS 1851 with AS 1670.1 for the system requirements',
    tests: [
      {
        id: 'asd-s-01', section: 'Airflow', label: 'Airflow within normalised range', assetTypeId: 'asd',
        measurementKey: 'Airflow', measurementUnit: '%',
        passCriteria: 'Within the tolerance set at commissioning.',
        defectCode: 'ASD-DET-001', sourceKind: 'standard',
      },
      {
        id: 'asd-s-02', section: 'Filter', label: 'Filter condition', assetTypeId: 'asd',
        defectCode: 'ASD-DET-002', sourceKind: 'manufacturer',
      },
      {
        id: 'asd-s-03', section: 'Response', label: 'Smoke test at the end sampling point', assetTypeId: 'sampling-point',
        whatToDo: 'Introduce test smoke at the furthest sampling point and time the response.',
        measurementKey: 'Transport time', measurementUnit: 's',
        passCriteria: 'Response within the transport time recorded at commissioning.',
        defectCode: 'ASD-DET-003', sourceKind: 'standard',
      },
      {
        id: 'asd-s-04', section: 'Pipework', label: 'Pipe network intact', assetTypeId: 'asd',
        whatToLookFor: 'Damage, disconnection or modification from the commissioned design.',
        defectCode: 'ASD-PIP-001', sourceKind: 'standard', photoRequired: true,
      },
    ],
  },

  // ---------------------------------------------------------------- fire doors
  {
    id: 'dor-six-monthly',
    label: 'Fire and smoke doors — six-monthly',
    system: 'door',
    frequency: 'six-monthly',
    description: 'Self-closing and latching, hardware condition, gaps, seals and tagging.',
    sourceKind: 'standard',
    sourceRef: 'AS 1851 with AS 1905 for the door requirements',
    tests: [
      {
        id: 'dor-s-01', section: 'Operation', label: 'Self-closes and latches', assetTypeId: 'fire-door',
        whatToDo: 'Release the door from several open positions, including part-open.',
        passCriteria: 'Closes fully and latches from every position tested.',
        defectCode: 'DOR-FD-001', sourceKind: 'standard', photoRequired: true,
      },
      {
        id: 'dor-s-02', section: 'Operation', label: 'Not wedged or held open', assetTypeId: 'fire-door',
        defectCode: 'DOR-FD-002', sourceKind: 'standard',
      },
      {
        id: 'dor-s-03', section: 'Condition', label: 'Gaps within tolerance', assetTypeId: 'fire-door',
        measurementKey: 'Largest gap', measurementUnit: 'mm',
        defectCode: 'DOR-FD-003', sourceKind: 'standard', verify: true,
      },
      {
        id: 'dor-s-04', section: 'Records', label: 'Tag present and legible', assetTypeId: 'fire-door',
        defectCode: 'DOR-FD-004', sourceKind: 'standard',
      },
    ],
  },

  // ------------------------------------------------------------- passive fire
  {
    id: 'pas-annual',
    label: 'Passive fire — annual',
    system: 'passive',
    frequency: 'annual',
    description: 'Penetration seal survey and damper operation.',
    sourceKind: 'standard',
    sourceRef: 'AS 1851 — routine service of passive fire and smoke systems',
    tests: [
      {
        id: 'pas-a-01', section: 'Penetrations', label: 'Seals intact and tagged', assetTypeId: 'penetration',
        whatToLookFor: 'New unsealed penetrations, disturbed or damaged fire-stopping, missing tags.',
        defectCode: 'PAS-PEN-001', sourceKind: 'standard', photoRequired: true,
      },
      {
        id: 'pas-a-02', section: 'Dampers', label: 'Damper releases and reinstates', assetTypeId: 'fire-damper',
        whatToDo: 'Operate the damper through its release and reset it.',
        defectCode: 'PAS-DMP-001', sourceKind: 'standard',
      },
    ],
  },
  // --------------------------------------------------------------- five-yearly
  //
  // The long-interval work. These matter disproportionately: they are the
  // activities most often skipped, because a five-year gap outlasts the
  // technician, the contract and often the building manager. Every interval and
  // pressure here is flagged for verification — the specific figure belongs to
  // the current standard or the cylinder, not to this file.
  {
    id: 'ext-five-yearly',
    label: 'Extinguishers — five-yearly',
    system: 'extinguisher',
    frequency: 'five-yearly',
    description: 'Pressure test, discharge and refill of portable equipment at its long interval, and replacement of anything beyond service life.',
    sourceKind: 'standard',
    sourceRef: 'AS 1851 — portable fire equipment, five-yearly activities',
    tests: [
      {
        id: 'ext-5-01', section: 'Pressure test', label: 'Cylinder pressure tested or replaced', assetTypeId: 'extinguisher',
        whatToDo: 'Confirm the cylinder has been pressure tested within its required interval, or replace it.',
        whatToLookFor: 'Test date stamped or labelled on the cylinder, and the interval that applies to this type.',
        failCriteria: 'Test overdue, unreadable, or absent.',
        defectCode: 'EXT-EXT-003', sourceKind: 'standard', verify: true, photoRequired: true,
      },
      {
        id: 'ext-5-02', section: 'Discharge', label: 'Discharged and refilled', assetTypeId: 'extinguisher',
        whatToDo: 'Discharge, internally inspect, refill and recharge to the manufacturer\u2019s stated charge.',
        measurementKey: 'Charged mass', measurementUnit: 'kg',
        defectCode: 'EXT-EXT-001', sourceKind: 'standard', verify: true,
      },
      {
        id: 'ext-5-03', section: 'Service life', label: 'Within service life', assetTypeId: 'extinguisher',
        whatToDo: 'Check age against the service life for the type and replace rather than retest where it is exceeded.',
        failCriteria: 'Beyond service life, whatever the test result.',
        defectCode: 'EXT-EXT-005', sourceKind: 'standard', verify: true,
      },
    ],
  },
  {
    id: 'hose-reel-five-yearly',
    label: 'Hose reels — five-yearly',
    system: 'hose-reel',
    frequency: 'five-yearly',
    description: 'Hose pressure test and full deployment, which the shorter intervals do not cover.',
    sourceKind: 'standard',
    sourceRef: 'AS 1851 — fire hose reels, five-yearly activities',
    tests: [
      {
        id: 'hr-5-01', section: 'Hose', label: 'Hose pressure tested', assetTypeId: 'hose-reel',
        whatToDo: 'Pressure test the hose to the required test pressure and hold for the required period.',
        measurementKey: 'Test pressure', measurementUnit: 'kPa',
        whatToLookFor: 'Leaks, weeping at the couplings, bulging or delamination under pressure.',
        defectCode: 'FHR-HOS-001', sourceKind: 'standard', verify: true, photoRequired: true,
      },
      {
        id: 'hr-5-02', section: 'Deployment', label: 'Fully deployed and rewound', assetTypeId: 'hose-reel',
        whatToDo: 'Run the hose out to its full length, check along the whole run, then rewind without twists.',
        whatToLookFor: 'Kinks, abrasion, perished sections, and whether the reel turns freely under load.',
        failCriteria: 'Hose damaged anywhere along its length, or the reel binds.',
        defectCode: 'FHR-HOS-001', sourceKind: 'standard',
      },
      {
        id: 'hr-5-03', section: 'Flow', label: 'Flow and nozzle performance', assetTypeId: 'hose-reel',
        whatToDo: 'Measure flow at the nozzle at full deployment.',
        measurementKey: 'Flow rate', measurementUnit: 'L/min',
        defectCode: 'FHR-REL-001', sourceKind: 'standard', verify: true,
      },
    ],
  },
  {
    id: 'hydrant-five-yearly',
    label: 'Hydrants — five-yearly',
    system: 'hydrant',
    frequency: 'five-yearly',
    description: 'Full flow and pressure test of the hydrant system, including the booster, at its long interval.',
    sourceKind: 'standard',
    sourceRef: 'AS 1851 — fire hydrant systems, five-yearly activities',
    tests: [
      {
        id: 'hyd-5-01', section: 'Flow', label: 'System flow test at the hydraulically worst hydrant', assetTypeId: 'hydrant',
        whatToDo: 'Flow the system at the hydraulically most disadvantaged outlet and record flow and residual pressure.',
        measurementKey: 'Residual pressure', measurementUnit: 'kPa',
        defectCode: 'HYD-HYD-001', sourceKind: 'standard', verify: true, photoRequired: true,
      },
      {
        id: 'hyd-5-02', section: 'Booster', label: 'Booster assembly tested', assetTypeId: 'booster',
        whatToDo: 'Test the booster inlets, check the non-return valves and confirm the connection type matches what the brigade will arrive with.',
        whatToLookFor: 'Blanks and caps present, threads undamaged, signage legible, access unobstructed.',
        defectCode: 'HYD-BST-002', sourceKind: 'standard', photoRequired: true,
      },
      {
        id: 'hyd-5-03', section: 'Valves', label: 'Isolation valves exercised through full travel', assetTypeId: 'hydrant',
        whatToDo: 'Operate each isolation valve through its full travel and return it to the correct position.',
        failCriteria: 'Valve seized, partly closed, or left other than as found.',
        defectCode: 'HYD-HYD-002', sourceKind: 'standard',
      },
    ],
  },
  {
    id: 'sprinkler-five-yearly',
    label: 'Sprinkler — five-yearly',
    system: 'sprinkler',
    frequency: 'five-yearly',
    description: 'Internal pipework condition, head sampling and valve overhaul, none of which the shorter intervals reach.',
    sourceKind: 'standard',
    sourceRef: 'AS 1851 — automatic fire sprinkler systems, five-yearly activities',
    tests: [
      {
        id: 'spr-5-01', section: 'Pipework', label: 'Internal pipework inspected for obstruction', assetTypeId: 'sprinkler-valve',
        whatToDo: 'Open the system at the required points and inspect internally.',
        whatToLookFor: 'Scale, corrosion products, foreign material, and any sign of microbiologically influenced corrosion.',
        defectCode: 'SPR-PIP-001', sourceKind: 'standard', verify: true, photoRequired: true,
      },
      {
        id: 'spr-5-02', section: 'Heads', label: 'Head sample submitted for testing', assetTypeId: 'sprinkler-head',
        whatToDo: 'Take the required sample of heads for laboratory testing and replace those removed.',
        whatToLookFor: 'Heads showing corrosion, paint, loading or physical damage — sample those in preference.',
        defectCode: 'SPR-HD-004', sourceKind: 'standard', verify: true,
      },
      {
        id: 'spr-5-03', section: 'Valves', label: 'Alarm valve overhauled', assetTypeId: 'sprinkler-valve',
        whatToDo: 'Strip, inspect and reassemble the alarm valve, replacing seats and seals as required.',
        defectCode: 'SPR-VLV-003', sourceKind: 'manufacturer', verify: true,
      },
      {
        id: 'spr-5-04', section: 'Alarm', label: 'Flow alarm proved end to end after reassembly', assetTypeId: 'flow-switch',
        whatToDo: 'Flow the test connection and confirm the alarm reaches the panel and the monitoring service.',
        passCriteria: 'Alarm received at the panel and acknowledged by monitoring within the expected time.',
        defectCode: 'SPR-FSW-001', sourceKind: 'standard', verify: true,
      },
    ],
  },
  {
    id: 'pump-five-yearly',
    label: 'Fire pumps — five-yearly',
    system: 'pump',
    frequency: 'five-yearly',
    description: 'Full-flow performance test against the pump curve, which the routine running tests do not establish.',
    sourceKind: 'standard',
    sourceRef: 'AS 1851 — fire pumpsets, five-yearly activities',
    tests: [
      {
        id: 'pmp-5-01', section: 'Performance', label: 'Full flow test against the pump curve', assetTypeId: 'fire-pump',
        whatToDo: 'Run the pump across its flow range and record pressure at each point, comparing against the commissioning curve.',
        measurementKey: 'Duty point pressure', measurementUnit: 'kPa',
        failCriteria: 'Performance fallen below the commissioning curve by more than the allowance.',
        defectCode: 'PMP-PMP-002', sourceKind: 'standard', verify: true, photoRequired: true,
      },
      {
        id: 'pmp-5-02', section: 'Supply', label: 'Suction and supply verified at full flow', assetTypeId: 'water-tank',
        whatToDo: 'Confirm the supply sustains full flow for the required duration without the level falling below the outlet.',
        measurementKey: 'Duration sustained', measurementUnit: 'min',
        defectCode: 'PMP-TNK-001', sourceKind: 'standard', verify: true,
      },
      {
        id: 'pmp-5-03', section: 'Controller', label: 'Controller sequence and changeover proved', assetTypeId: 'pump-controller',
        whatToDo: 'Prove the start sequence, the changeover to the alternate supply and every alarm output.',
        defectCode: 'PMP-CTL-001', sourceKind: 'manufacturer', verify: true,
      },
    ],
  },

];

export function routinesForSystem(system: SystemKind): ServiceRoutine[] {
  return SERVICE_ROUTINES.filter((r) => r.system === system);
}

export function routineById(id: string): ServiceRoutine | undefined {
  return SERVICE_ROUTINES.find((r) => r.id === id);
}

/** Tests in a routine that apply to a given asset type, plus system-level checks. */
export function testsForAssetType(routine: ServiceRoutine, assetTypeId?: string): TestDef[] {
  return routine.tests.filter((t) => !t.assetTypeId || t.assetTypeId === assetTypeId);
}
