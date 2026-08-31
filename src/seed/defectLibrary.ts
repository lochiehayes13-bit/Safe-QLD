import type { SystemKind } from './assetTypes';

/**
 * Coded defect library.
 *
 * A technician picks system, component and defect; the app supplies the
 * severity, the formal wording, the plain-English client wording and the work
 * needed to clear it. That keeps a service record consistent whoever wrote it,
 * and lets a defect turn into a quote without anyone retyping it.
 *
 * Severity follows the safety and compliance impact, not how annoying the fault
 * is: critical means the system cannot do its job.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface QuoteItem {
  description: string;
  unit: 'ea' | 'hr' | 'm' | 'lot';
  qtyPerDefect: number;
}

export interface DefectCode {
  code: string;
  system: SystemKind;
  component: string;
  defect: string;
  severity: Severity;
  /** Wording for the formal service record. */
  reportWording: string;
  /** Plain-English wording for the client. */
  clientWording?: string;
  /** What the technician actually has to do. */
  rectification?: string;
  quoteItems?: QuoteItem[];
  photoRequired?: boolean;
}

const REPLACE_LABOUR: QuoteItem = { description: 'Labour — remove and replace', unit: 'hr', qtyPerDefect: 0.5 };
const TEST_LABOUR: QuoteItem = { description: 'Labour — test and commission', unit: 'hr', qtyPerDefect: 0.25 };

export const DEFECT_LIBRARY: DefectCode[] = [
  // ======================================================== DETECTION
  {
    code: 'DET-DET-001', system: 'detection', component: 'Detector', defect: 'Failed to alarm on test',
    severity: 'critical',
    reportWording: 'Detector failed to enter alarm when tested by the approved method and did not report to the fire indicator panel.',
    clientWording: 'A smoke detector did not activate when tested and needs replacing so the area is properly covered.',
    rectification: 'Replace the detector head, re-test to confirm alarm and correct panel reporting, and confirm the zone text matches the location.',
    quoteItems: [{ description: 'Replacement detector head', unit: 'ea', qtyPerDefect: 1 }, REPLACE_LABOUR, TEST_LABOUR],
    photoRequired: true,
  },
  {
    code: 'DET-DET-002', system: 'detection', component: 'Detector', defect: 'Contaminated',
    severity: 'high',
    reportWording: 'Detector found contaminated with dust or debris, placing it outside its rated sensitivity range.',
    clientWording: 'A detector has become dirty enough to affect how reliably it works.',
    rectification: 'Clean or replace the detector, then verify sensitivity is back within range. Where contamination recurs, investigate the cause before replacing again.',
    quoteItems: [{ description: 'Detector clean or replacement', unit: 'ea', qtyPerDefect: 1 }, REPLACE_LABOUR],
    photoRequired: true,
  },
  {
    code: 'DET-DET-003', system: 'detection', component: 'Detector', defect: 'Missing',
    severity: 'critical',
    reportWording: 'Detector recorded on the asset register and required by the system design was not present at its location.',
    clientWording: 'A detector is missing from where it should be, leaving that area without coverage.',
    rectification: 'Install a replacement detector on the existing base, address it correctly and test.',
    quoteItems: [{ description: 'Replacement detector head', unit: 'ea', qtyPerDefect: 1 }, REPLACE_LABOUR, TEST_LABOUR],
    photoRequired: true,
  },
  {
    code: 'DET-DET-004', system: 'detection', component: 'Detector', defect: 'Physically damaged',
    severity: 'high',
    reportWording: 'Detector housing found physically damaged, compromising its ability to operate as intended.',
    rectification: 'Replace the detector and investigate the cause of the damage.',
    quoteItems: [{ description: 'Replacement detector head', unit: 'ea', qtyPerDefect: 1 }, REPLACE_LABOUR],
    photoRequired: true,
  },
  {
    code: 'DET-DET-005', system: 'detection', component: 'Detector', defect: 'Painted over',
    severity: 'critical',
    reportWording: 'Detector found with paint applied to the housing or sampling apertures, preventing products of combustion reaching the sensing chamber.',
    rectification: 'Replace the detector. Painted detectors cannot be returned to service by cleaning.',
    quoteItems: [{ description: 'Replacement detector head', unit: 'ea', qtyPerDefect: 1 }, REPLACE_LABOUR],
    photoRequired: true,
  },
  {
    code: 'DET-DET-006', system: 'detection', component: 'Detector', defect: 'Obstructed',
    severity: 'high',
    reportWording: 'Detector obstructed by stored goods, partitions or building services, preventing smoke reaching it.',
    clientWording: 'Something has been installed or stored too close to a detector and is blocking it.',
    rectification: 'Clear the obstruction, or relocate the detector where the obstruction is permanent.',
    photoRequired: true,
  },
  {
    code: 'DET-DET-007', system: 'detection', component: 'Detector', defect: 'Unsuitable for the environment',
    severity: 'medium',
    reportWording: 'Detector type is unsuited to the environmental conditions at its location, leading to repeated contamination or unwanted alarms.',
    rectification: 'Replace with a detector type appropriate to the environment, or relocate. Confirm the change against the system design.',
    quoteItems: [{ description: 'Alternative detector type', unit: 'ea', qtyPerDefect: 1 }, REPLACE_LABOUR, TEST_LABOUR],
  },
  {
    code: 'DET-DET-008', system: 'detection', component: 'Detector', defect: 'Inaccessible for testing',
    severity: 'medium',
    reportWording: 'Detector could not be reached for testing with the access equipment available. The device remains untested.',
    clientWording: 'A detector could not be reached to test it and will need access arranged.',
    rectification: 'Arrange suitable access equipment or a permit and return to complete the test.',
    photoRequired: true,
  },
  {
    code: 'DET-MCP-001', system: 'detection', component: 'Manual call point', defect: 'Failed to alarm on operation',
    severity: 'critical',
    reportWording: 'Manual call point did not report an alarm to the fire indicator panel when operated.',
    rectification: 'Replace the call point or repair the circuit, then re-test.',
    quoteItems: [{ description: 'Replacement manual call point', unit: 'ea', qtyPerDefect: 1 }, REPLACE_LABOUR, TEST_LABOUR],
    photoRequired: true,
  },
  {
    code: 'DET-MCP-002', system: 'detection', component: 'Manual call point', defect: 'Damaged or missing cover',
    severity: 'medium',
    reportWording: 'Manual call point found with a damaged or missing protective cover or element.',
    rectification: 'Fit a replacement cover or resettable element.',
    quoteItems: [{ description: 'Replacement cover / element', unit: 'ea', qtyPerDefect: 1 }],
    photoRequired: true,
  },
  {
    code: 'DET-MCP-003', system: 'detection', component: 'Manual call point', defect: 'Obstructed or concealed',
    severity: 'high',
    reportWording: 'Manual call point obstructed or concealed, preventing ready access by occupants.',
    clientWording: 'A break-glass alarm point is blocked and cannot be reached quickly in an emergency.',
    rectification: 'Clear the obstruction and confirm the call point is visible and reachable.',
    photoRequired: true,
  },
  {
    code: 'DET-FIP-001', system: 'detection', component: 'Fire indicator panel', defect: 'Fault condition present',
    severity: 'high',
    reportWording: 'Fire indicator panel displaying an unresolved fault condition at the time of service.',
    rectification: 'Diagnose the fault from the panel display and event log, rectify the cause, then confirm the panel returns to normal.',
    quoteItems: [{ description: 'Labour — fault diagnosis', unit: 'hr', qtyPerDefect: 2 }],
    photoRequired: true,
  },
  {
    code: 'DET-FIP-002', system: 'detection', component: 'Fire indicator panel', defect: 'Earth fault',
    severity: 'high',
    reportWording: 'Earth fault present on the fire indicator panel. A second earth fault could disable part of the system.',
    rectification: 'Isolate loops section by section to locate the fault, repair the affected cabling or device, and confirm the earth fault clears.',
    quoteItems: [{ description: 'Labour — earth fault location', unit: 'hr', qtyPerDefect: 3 }],
  },
  {
    code: 'DET-FIP-003', system: 'detection', component: 'Fire indicator panel', defect: 'Loop fault',
    severity: 'high',
    reportWording: 'Loop fault present, indicating a break, short or device failure on the detection loop.',
    rectification: 'Check loop current and isolators, identify the affected section, repair the cabling or replace the failed device, then confirm all devices poll.',
    quoteItems: [{ description: 'Labour — loop fault location', unit: 'hr', qtyPerDefect: 3 }],
  },
  {
    code: 'DET-FIP-004', system: 'detection', component: 'Fire indicator panel', defect: 'Zone text incorrect',
    severity: 'medium',
    reportWording: 'Zone or point text programmed at the panel does not describe the actual location of the devices in that zone.',
    clientWording: 'The descriptions shown on the fire panel do not match where the detectors actually are, which would slow down the fire brigade.',
    rectification: 'Correct the zone and point text in the panel configuration and update the zone chart and block plan to match.',
    quoteItems: [{ description: 'Labour — configuration change', unit: 'hr', qtyPerDefect: 1 }],
  },
  {
    code: 'DET-FIP-005', system: 'detection', component: 'Fire indicator panel', defect: 'Device isolated and left isolated',
    severity: 'critical',
    reportWording: 'Devices found isolated at the fire indicator panel with no impairment record in place, leaving part of the system out of service.',
    rectification: 'Establish why the isolation was applied, rectify the underlying fault, restore the devices and confirm the panel is normal.',
  },
  {
    code: 'DET-BAT-001', system: 'detection', component: 'Standby battery', defect: 'Failed load test',
    severity: 'critical',
    reportWording: 'Standby battery failed its discharge test, with terminal voltage falling below the permitted minimum before the required duration elapsed.',
    clientWording: 'The backup battery for the fire panel will not hold the system up during a power failure and needs replacing.',
    rectification: 'Replace the battery set with the calculated capacity, record the manufacture date and re-test.',
    quoteItems: [{ description: 'Replacement battery set', unit: 'ea', qtyPerDefect: 2 }, REPLACE_LABOUR, TEST_LABOUR],
    photoRequired: true,
  },
  {
    code: 'DET-BAT-002', system: 'detection', component: 'Standby battery', defect: 'Undersized for the system load',
    severity: 'high',
    reportWording: 'Installed standby battery capacity is below the capacity required by calculation for the connected load and standby period.',
    rectification: 'Recalculate the required capacity from the measured quiescent and alarm currents, and install a battery set of at least that capacity.',
    quoteItems: [{ description: 'Correctly sized battery set', unit: 'ea', qtyPerDefect: 2 }, REPLACE_LABOUR],
  },
  {
    code: 'DET-BAT-003', system: 'detection', component: 'Standby battery', defect: 'Leaking or swollen',
    severity: 'critical',
    reportWording: 'Standby battery found leaking or with a distorted case, indicating internal failure.',
    rectification: 'Replace the battery set immediately and inspect the cabinet and charger for damage.',
    quoteItems: [{ description: 'Replacement battery set', unit: 'ea', qtyPerDefect: 2 }, REPLACE_LABOUR],
    photoRequired: true,
  },
  {
    code: 'DET-BAT-004', system: 'detection', component: 'Charger', defect: 'Charge voltage out of range',
    severity: 'high',
    reportWording: 'Battery charging voltage measured outside the manufacturer’s specified range, which will shorten battery life or leave the battery undercharged.',
    rectification: 'Adjust or replace the charger, then confirm charge voltage and current against the manufacturer figures.',
    quoteItems: [{ description: 'Labour — charger adjustment or replacement', unit: 'hr', qtyPerDefect: 1.5 }],
  },
  {
    code: 'DET-MOD-001', system: 'detection', component: 'Interface module', defect: 'Failed to operate',
    severity: 'critical',
    reportWording: 'Interface module did not operate its associated input or output when tested.',
    rectification: 'Replace the module, re-address it and re-test the associated function end to end.',
    quoteItems: [{ description: 'Replacement module', unit: 'ea', qtyPerDefect: 1 }, REPLACE_LABOUR, TEST_LABOUR],
  },
  {
    code: 'DET-CBL-001', system: 'detection', component: 'Cabling', defect: 'Damaged or unsupported',
    severity: 'high',
    reportWording: 'Fire detection cabling found damaged, unsupported or run in a manner that does not maintain its required integrity.',
    rectification: 'Repair or replace the affected cable run and support it correctly.',
    quoteItems: [{ description: 'Fire-rated cable', unit: 'm', qtyPerDefect: 10 }, { description: 'Labour — cable repair', unit: 'hr', qtyPerDefect: 2 }],
    photoRequired: true,
  },

  // ======================================================== EWIS / OWS
  {
    code: 'EWS-SPK-001', system: 'ews', component: 'Speaker', defect: 'No audible output',
    severity: 'critical',
    reportWording: 'Speaker produced no audible output when the occupant warning system was operated.',
    rectification: 'Trace the speaker circuit, repair the fault or replace the speaker, then re-test the circuit.',
    quoteItems: [{ description: 'Replacement speaker', unit: 'ea', qtyPerDefect: 1 }, REPLACE_LABOUR, TEST_LABOUR],
  },
  {
    code: 'EWS-SPK-002', system: 'ews', component: 'Speaker', defect: 'Sound pressure level below requirement',
    severity: 'high',
    reportWording: 'Measured sound pressure level in the area served is below the level required for the alarm signal to be clearly audible.',
    clientWording: 'The evacuation alarm cannot be heard clearly enough in part of the building.',
    rectification: 'Increase the speaker tapping or add speakers, then re-measure to confirm the required level is achieved throughout.',
    quoteItems: [{ description: 'Additional speaker', unit: 'ea', qtyPerDefect: 1 }, REPLACE_LABOUR, TEST_LABOUR],
  },
  {
    code: 'EWS-AMP-001', system: 'ews', component: 'Amplifier', defect: 'Amplifier fault',
    severity: 'critical',
    reportWording: 'Occupant warning system amplifier in fault, preventing the alarm signal being broadcast to the affected circuits.',
    rectification: 'Replace the amplifier module and re-test every circuit it serves.',
    quoteItems: [{ description: 'Replacement amplifier', unit: 'ea', qtyPerDefect: 1 }, { description: 'Labour — replace and commission', unit: 'hr', qtyPerDefect: 2 }],
  },
  {
    code: 'EWS-CCT-001', system: 'ews', component: 'Speaker circuit', defect: 'Circuit fault',
    severity: 'high',
    reportWording: 'Speaker circuit reporting a fault, indicating an open circuit, short circuit or impedance outside the permitted range.',
    rectification: 'Measure circuit impedance, locate and repair the fault, then confirm the circuit reads within range.',
    quoteItems: [{ description: 'Labour — circuit fault location', unit: 'hr', qtyPerDefect: 2 }],
  },
  {
    code: 'EWS-WIP-001', system: 'ews', component: 'Warden intercom phone', defect: 'Failed call test',
    severity: 'high',
    reportWording: 'Warden intercom phone failed its call test and could not establish communication with the master station.',
    rectification: 'Repair or replace the handset or line, then re-test communication in both directions.',
    quoteItems: [{ description: 'Replacement WIP handset', unit: 'ea', qtyPerDefect: 1 }, REPLACE_LABOUR, TEST_LABOUR],
  },
  {
    code: 'EWS-VAD-001', system: 'ews', component: 'Visual alarm device', defect: 'Failed to operate',
    severity: 'high',
    reportWording: 'Visual alarm device did not operate when the occupant warning system was activated.',
    rectification: 'Replace the device and re-test.',
    quoteItems: [{ description: 'Replacement visual alarm device', unit: 'ea', qtyPerDefect: 1 }, REPLACE_LABOUR],
  },
  {
    code: 'EWS-PNL-001', system: 'ews', component: 'EWIS panel', defect: 'Microphone fault',
    severity: 'high',
    reportWording: 'Emergency warning system microphone did not broadcast when tested.',
    rectification: 'Replace the microphone or repair the connection, then confirm broadcast to all zones.',
    quoteItems: [{ description: 'Replacement microphone', unit: 'ea', qtyPerDefect: 1 }, REPLACE_LABOUR],
  },

  // ======================================================== EMERGENCY LIGHTING
  {
    code: 'EEL-FIT-001', system: 'emergency-lighting', component: 'Emergency light', defect: 'Failed discharge test',
    severity: 'high',
    reportWording: 'Emergency lighting fitting failed the required discharge test, extinguishing before the required duration elapsed.',
    clientWording: 'An emergency light will not stay on for the full time required during a power failure and needs replacing.',
    rectification: 'Replace the fitting or its battery, then re-test for the full discharge period.',
    quoteItems: [{ description: 'Replacement emergency fitting', unit: 'ea', qtyPerDefect: 1 }, REPLACE_LABOUR, { description: 'Labour — discharge test', unit: 'hr', qtyPerDefect: 0.25 }],
    photoRequired: true,
  },
  {
    code: 'EEL-FIT-002', system: 'emergency-lighting', component: 'Emergency light', defect: 'Not illuminating',
    severity: 'high',
    reportWording: 'Emergency lighting fitting did not illuminate on loss of normal supply.',
    rectification: 'Replace the fitting and confirm operation on loss of supply.',
    quoteItems: [{ description: 'Replacement emergency fitting', unit: 'ea', qtyPerDefect: 1 }, REPLACE_LABOUR],
    photoRequired: true,
  },
  {
    code: 'EEL-FIT-003', system: 'emergency-lighting', component: 'Emergency light', defect: 'Charge indicator not lit',
    severity: 'medium',
    reportWording: 'Fitting charge indicator not illuminated, indicating the battery is not being charged.',
    rectification: 'Confirm supply to the fitting, then replace the fitting or its charging circuit.',
    quoteItems: [{ description: 'Replacement emergency fitting', unit: 'ea', qtyPerDefect: 1 }, REPLACE_LABOUR],
  },
  {
    code: 'EEL-EXT-001', system: 'emergency-lighting', component: 'Exit sign', defect: 'Not illuminated',
    severity: 'high',
    reportWording: 'Exit sign not illuminated, so the path of egress is not marked as required.',
    clientWording: 'An exit sign is not lit, so people would not be able to see the way out in an emergency.',
    rectification: 'Replace the sign or its lamp and confirm illumination on both normal and emergency supply.',
    quoteItems: [{ description: 'Replacement exit sign', unit: 'ea', qtyPerDefect: 1 }, REPLACE_LABOUR],
    photoRequired: true,
  },
  {
    code: 'EEL-EXT-002', system: 'emergency-lighting', component: 'Exit sign', defect: 'Obscured or incorrect direction',
    severity: 'medium',
    reportWording: 'Exit sign obscured, or the directional arrow does not indicate the correct path of travel to an exit.',
    rectification: 'Clear the obstruction or fit the correct directional legend.',
    photoRequired: true,
  },
  {
    code: 'EEL-FIT-004', system: 'emergency-lighting', component: 'Emergency light', defect: 'Diffuser damaged or missing',
    severity: 'low',
    reportWording: 'Fitting diffuser damaged or missing, reducing light output and exposing internal components.',
    rectification: 'Fit a replacement diffuser.',
    quoteItems: [{ description: 'Replacement diffuser', unit: 'ea', qtyPerDefect: 1 }],
  },

  // ======================================================== EXTINGUISHERS
  {
    code: 'EXT-EXT-001', system: 'extinguisher', component: 'Extinguisher', defect: 'Discharged or low pressure',
    severity: 'high',
    reportWording: 'Extinguisher found discharged or with gauge pressure outside the operating range, so it would not perform as intended.',
    clientWording: 'A fire extinguisher has lost pressure and would not work properly.',
    rectification: 'Recharge or replace the extinguisher and return it to its bracket with current service tagging.',
    quoteItems: [{ description: 'Extinguisher recharge or replacement', unit: 'ea', qtyPerDefect: 1 }, REPLACE_LABOUR],
    photoRequired: true,
  },
  {
    code: 'EXT-EXT-002', system: 'extinguisher', component: 'Extinguisher', defect: 'Missing from location',
    severity: 'high',
    reportWording: 'Extinguisher recorded at this location was not present.',
    rectification: 'Supply and install a replacement extinguisher of the correct type and rating, with signage.',
    quoteItems: [{ description: 'Replacement extinguisher', unit: 'ea', qtyPerDefect: 1 }, REPLACE_LABOUR],
    photoRequired: true,
  },
  {
    code: 'EXT-EXT-003', system: 'extinguisher', component: 'Extinguisher', defect: 'Pressure test overdue',
    severity: 'medium',
    reportWording: 'Extinguisher is beyond the date at which pressure testing is required and cannot remain in service until tested.',
    rectification: 'Remove for pressure testing or replace, and update the asset record with the new test date.',
    quoteItems: [{ description: 'Pressure test or replacement', unit: 'ea', qtyPerDefect: 1 }, REPLACE_LABOUR],
  },
  {
    code: 'EXT-EXT-004', system: 'extinguisher', component: 'Extinguisher', defect: 'Obstructed access',
    severity: 'medium',
    reportWording: 'Access to the extinguisher obstructed by stored goods or equipment.',
    clientWording: 'A fire extinguisher is blocked and could not be reached quickly.',
    rectification: 'Clear the obstruction and confirm the extinguisher is visible and reachable.',
    photoRequired: true,
  },
  {
    code: 'EXT-EXT-005', system: 'extinguisher', component: 'Extinguisher', defect: 'Corroded or damaged cylinder',
    severity: 'high',
    reportWording: 'Extinguisher cylinder found corroded or physically damaged, so its integrity cannot be relied upon.',
    rectification: 'Remove from service and replace.',
    quoteItems: [{ description: 'Replacement extinguisher', unit: 'ea', qtyPerDefect: 1 }, REPLACE_LABOUR],
    photoRequired: true,
  },
  {
    code: 'EXT-BRK-001', system: 'extinguisher', component: 'Bracket', defect: 'Missing or damaged',
    severity: 'medium',
    reportWording: 'Extinguisher bracket missing or damaged, leaving the extinguisher unsecured or stored on the floor.',
    rectification: 'Fit a correct bracket at the required mounting height.',
    quoteItems: [{ description: 'Extinguisher bracket', unit: 'ea', qtyPerDefect: 1 }, REPLACE_LABOUR],
  },
  {
    code: 'EXT-SGN-001', system: 'extinguisher', component: 'Signage', defect: 'Missing or incorrect',
    severity: 'low',
    reportWording: 'Location signage for the extinguisher is missing, incorrect for the extinguisher type, or not visible from the approach.',
    rectification: 'Fit correct location signage visible from the normal approach.',
    quoteItems: [{ description: 'Location sign', unit: 'ea', qtyPerDefect: 1 }],
  },

  // ======================================================== HOSE REEL
  {
    code: 'FHR-REL-001', system: 'hose-reel', component: 'Hose reel', defect: 'Flow below requirement',
    severity: 'high',
    reportWording: 'Hose reel flow measured at the nozzle is below the required minimum.',
    rectification: 'Investigate supply pressure, valve position and any restriction in the reel or nozzle, rectify and re-test.',
    quoteItems: [{ description: 'Labour — investigate and rectify', unit: 'hr', qtyPerDefect: 2 }],
  },
  {
    code: 'FHR-HOS-001', system: 'hose-reel', component: 'Hose', defect: 'Perished or damaged',
    severity: 'high',
    reportWording: 'Hose found perished, split or otherwise damaged and would not deliver water reliably.',
    rectification: 'Replace the hose and re-test flow.',
    quoteItems: [{ description: 'Replacement hose', unit: 'ea', qtyPerDefect: 1 }, REPLACE_LABOUR, TEST_LABOUR],
    photoRequired: true,
  },
  {
    code: 'FHR-NOZ-001', system: 'hose-reel', component: 'Nozzle', defect: 'Missing or damaged',
    severity: 'medium',
    reportWording: 'Hose reel nozzle missing or damaged.',
    rectification: 'Fit a replacement nozzle and confirm shut-off operates.',
    quoteItems: [{ description: 'Replacement nozzle', unit: 'ea', qtyPerDefect: 1 }],
  },
  {
    code: 'FHR-REL-002', system: 'hose-reel', component: 'Hose reel', defect: 'Obstructed',
    severity: 'medium',
    reportWording: 'Access to the hose reel obstructed, preventing it being deployed.',
    rectification: 'Clear the obstruction.',
    photoRequired: true,
  },

  // ======================================================== HYDRANT
  {
    code: 'HYD-HYD-001', system: 'hydrant', component: 'Hydrant', defect: 'Pressure below requirement',
    severity: 'critical',
    reportWording: 'Hydrant running pressure measured below the required minimum for the installation.',
    clientWording: 'A fire hydrant does not have enough water pressure for the fire brigade to use effectively.',
    rectification: 'Investigate the supply, pump operation and valve positions, then re-test. A hydraulic assessment may be required.',
    quoteItems: [{ description: 'Labour — investigation and re-test', unit: 'hr', qtyPerDefect: 4 }],
  },
  {
    code: 'HYD-HYD-002', system: 'hydrant', component: 'Hydrant', defect: 'Valve seized or leaking',
    severity: 'high',
    reportWording: 'Hydrant valve found seized, or leaking when closed.',
    rectification: 'Service or replace the valve and re-test for correct operation and sealing.',
    quoteItems: [{ description: 'Valve service or replacement', unit: 'ea', qtyPerDefect: 1 }, { description: 'Labour', unit: 'hr', qtyPerDefect: 2 }],
  },
  {
    code: 'HYD-HYD-003', system: 'hydrant', component: 'Hydrant', defect: 'Cap or blank missing',
    severity: 'low',
    reportWording: 'Hydrant outlet cap or blank missing, leaving the outlet open to debris.',
    rectification: 'Fit a replacement cap or blank with retaining chain.',
    quoteItems: [{ description: 'Outlet cap', unit: 'ea', qtyPerDefect: 1 }],
  },
  {
    code: 'HYD-BST-001', system: 'hydrant', component: 'Booster', defect: 'Obstructed or inaccessible',
    severity: 'critical',
    reportWording: 'Fire brigade booster assembly obstructed or not accessible for brigade use.',
    clientWording: 'The fire brigade booster connection is blocked, which would delay the brigade connecting to the building.',
    rectification: 'Clear the obstruction and confirm unimpeded brigade access.',
    photoRequired: true,
  },
  {
    code: 'HYD-SGN-001', system: 'hydrant', component: 'Signage', defect: 'Missing or illegible',
    severity: 'medium',
    reportWording: 'Hydrant or booster signage missing, faded or illegible from the required viewing distance.',
    rectification: 'Fit correct, legible signage.',
    quoteItems: [{ description: 'Signage', unit: 'ea', qtyPerDefect: 1 }],
  },

  // ======================================================== SPRINKLER
  {
    code: 'SPR-HD-001', system: 'sprinkler', component: 'Sprinkler head', defect: 'Painted or coated',
    severity: 'critical',
    reportWording: 'Sprinkler head found painted or coated, which will delay or prevent operation of the thermal element.',
    rectification: 'Replace the head with an equivalent type, temperature rating and response characteristic.',
    quoteItems: [{ description: 'Replacement sprinkler head', unit: 'ea', qtyPerDefect: 1 }, REPLACE_LABOUR],
    photoRequired: true,
  },
  {
    code: 'SPR-HD-002', system: 'sprinkler', component: 'Sprinkler head', defect: 'Obstructed',
    severity: 'high',
    reportWording: 'Sprinkler head obstructed by stored goods, partitions or services, preventing correct distribution of water.',
    clientWording: 'Something is stored too close to a sprinkler and would stop it spraying properly.',
    rectification: 'Clear the obstruction, or relocate the head where the obstruction is permanent.',
    photoRequired: true,
  },
  {
    code: 'SPR-HD-003', system: 'sprinkler', component: 'Sprinkler head', defect: 'Corroded or damaged',
    severity: 'high',
    reportWording: 'Sprinkler head found corroded, damaged or with a distorted thermal element.',
    rectification: 'Replace the head with a matching type and rating.',
    quoteItems: [{ description: 'Replacement sprinkler head', unit: 'ea', qtyPerDefect: 1 }, REPLACE_LABOUR],
    photoRequired: true,
  },
  {
    code: 'SPR-VLV-001', system: 'sprinkler', component: 'Control valve', defect: 'Found closed or partially closed',
    severity: 'critical',
    reportWording: 'Sprinkler control valve found closed or partially closed, leaving the protected area without sprinkler protection.',
    clientWording: 'A sprinkler control valve was found shut, meaning the sprinklers in that area would not have worked.',
    rectification: 'Open the valve fully, secure it open, and establish why it was closed. Raise an impairment record for the period it was shut.',
    photoRequired: true,
  },
  {
    code: 'SPR-VLV-002', system: 'sprinkler', component: 'Control valve', defect: 'Tamper monitoring not operating',
    severity: 'high',
    reportWording: 'Valve tamper switch did not signal to the fire indicator panel when the valve was operated.',
    rectification: 'Repair or replace the tamper switch and re-test signalling to the panel.',
    quoteItems: [{ description: 'Replacement tamper switch', unit: 'ea', qtyPerDefect: 1 }, REPLACE_LABOUR, TEST_LABOUR],
  },
  {
    code: 'SPR-FSW-001', system: 'sprinkler', component: 'Flow switch', defect: 'Failed to signal',
    severity: 'critical',
    reportWording: 'Flow switch did not signal an alarm to the fire indicator panel when flow was established through the test valve.',
    rectification: 'Repair or replace the flow switch, confirm the delay setting, and re-test to the panel.',
    quoteItems: [{ description: 'Replacement flow switch', unit: 'ea', qtyPerDefect: 1 }, REPLACE_LABOUR, TEST_LABOUR],
  },

  // ======================================================== PUMP
  {
    code: 'PMP-PMP-001', system: 'pump', component: 'Fire pump', defect: 'Failed to start automatically',
    severity: 'critical',
    reportWording: 'Fire pump did not start automatically on pressure drop when tested.',
    clientWording: 'The fire pump did not start by itself when tested, so the system would not build pressure in a fire.',
    rectification: 'Diagnose the starting circuit, pressure switch and controller, rectify and re-test automatic starting.',
    quoteItems: [{ description: 'Labour — diagnose and rectify', unit: 'hr', qtyPerDefect: 4 }],
  },
  {
    code: 'PMP-PMP-002', system: 'pump', component: 'Fire pump', defect: 'Performance below rated duty',
    severity: 'high',
    reportWording: 'Pump flow and pressure measured below the rated duty point, indicating deterioration in pump performance.',
    rectification: 'Investigate suction conditions, impeller condition and drive, then re-test against the pump curve.',
    quoteItems: [{ description: 'Labour — performance investigation', unit: 'hr', qtyPerDefect: 4 }],
  },
  {
    code: 'PMP-PMP-003', system: 'pump', component: 'Fire pump', defect: 'Not in automatic',
    severity: 'critical',
    reportWording: 'Pump controller found with the pump not in automatic mode, so the pump would not start on demand.',
    rectification: 'Return the controller to automatic and establish why it was left in manual or off.',
    photoRequired: true,
  },
  {
    code: 'PMP-DSL-001', system: 'pump', component: 'Diesel pump', defect: 'Battery failure',
    severity: 'critical',
    reportWording: 'Diesel pump starting battery failed under load and would not crank the engine reliably.',
    rectification: 'Replace the starting battery set and confirm both starting circuits crank the engine.',
    quoteItems: [{ description: 'Replacement starting battery', unit: 'ea', qtyPerDefect: 2 }, REPLACE_LABOUR],
  },
  {
    code: 'PMP-TNK-001', system: 'pump', component: 'Water tank', defect: 'Level below requirement',
    severity: 'critical',
    reportWording: 'Water storage level found below the required volume for the installation.',
    rectification: 'Investigate the make-up supply and any leakage, restore the level and confirm the low level alarm operates.',
    quoteItems: [{ description: 'Labour — investigate make-up supply', unit: 'hr', qtyPerDefect: 2 }],
  },

  // ======================================================== ASPIRATING
  {
    code: 'ASD-DET-001', system: 'aspirating', component: 'Aspirating detector', defect: 'Airflow fault',
    severity: 'high',
    reportWording: 'Aspirating detector reporting an airflow fault, indicating a blocked, broken or altered sampling pipe network.',
    rectification: 'Inspect and clear the pipe network, confirm sampling point integrity, then re-normalise airflow at the detector.',
    quoteItems: [{ description: 'Labour — pipe network inspection', unit: 'hr', qtyPerDefect: 3 }],
  },
  {
    code: 'ASD-DET-002', system: 'aspirating', component: 'Aspirating detector', defect: 'Filter blocked',
    severity: 'medium',
    reportWording: 'Aspirating detector filter found blocked, reducing sampling performance.',
    rectification: 'Replace the filter cartridge and record the date.',
    quoteItems: [{ description: 'Replacement filter cartridge', unit: 'ea', qtyPerDefect: 1 }, REPLACE_LABOUR],
  },
  {
    code: 'ASD-PIP-001', system: 'aspirating', component: 'Sampling pipe', defect: 'Damaged or disconnected',
    severity: 'high',
    reportWording: 'Sampling pipe found damaged, disconnected or modified from the commissioned design.',
    rectification: 'Repair the pipe network to the commissioned design and re-test transport time.',
    quoteItems: [{ description: 'Pipe and fittings', unit: 'lot', qtyPerDefect: 1 }, { description: 'Labour — pipe repair', unit: 'hr', qtyPerDefect: 3 }],
    photoRequired: true,
  },

  // ======================================================== PASSIVE / DOOR
  {
    code: 'PAS-PEN-001', system: 'passive', component: 'Penetration', defect: 'Unsealed penetration',
    severity: 'critical',
    reportWording: 'Service penetration through a fire-rated barrier found unsealed, so the barrier does not achieve its required fire resistance level.',
    clientWording: 'A hole through a fire wall has not been sealed, so fire and smoke could pass through it.',
    rectification: 'Seal the penetration with a tested system appropriate to the barrier, the service and the required FRL, and tag it.',
    quoteItems: [{ description: 'Fire-stopping system', unit: 'ea', qtyPerDefect: 1 }, { description: 'Labour — install and tag', unit: 'hr', qtyPerDefect: 1 }],
    photoRequired: true,
  },
  {
    code: 'PAS-PEN-002', system: 'passive', component: 'Penetration', defect: 'Seal damaged or incomplete',
    severity: 'high',
    reportWording: 'Fire-stopping to a service penetration found damaged, disturbed or incomplete.',
    rectification: 'Make good the fire-stopping with a tested system and re-tag.',
    quoteItems: [{ description: 'Fire-stopping system', unit: 'ea', qtyPerDefect: 1 }, { description: 'Labour', unit: 'hr', qtyPerDefect: 1 }],
    photoRequired: true,
  },
  {
    code: 'DOR-FD-001', system: 'door', component: 'Fire door', defect: 'Does not self-close and latch',
    severity: 'critical',
    reportWording: 'Fire door did not self-close and latch from any open position, so it would not resist the passage of fire and smoke.',
    clientWording: 'A fire door does not close and latch by itself, so it would not hold back fire or smoke.',
    rectification: 'Adjust or replace the closer and latching hardware, then confirm the door closes and latches from any position.',
    quoteItems: [{ description: 'Door closer / hardware', unit: 'ea', qtyPerDefect: 1 }, { description: 'Labour — adjust and test', unit: 'hr', qtyPerDefect: 1 }],
    photoRequired: true,
  },
  {
    code: 'DOR-FD-002', system: 'door', component: 'Fire door', defect: 'Wedged or held open',
    severity: 'critical',
    reportWording: 'Fire door found wedged or otherwise held open by unapproved means.',
    clientWording: 'A fire door was propped open, which stops it doing its job entirely.',
    rectification: 'Remove the obstruction and confirm the door closes. Where the door needs to stay open, fit an approved hold-open device linked to the fire alarm.',
    photoRequired: true,
  },
  {
    code: 'DOR-FD-003', system: 'door', component: 'Fire door', defect: 'Excessive gaps',
    severity: 'high',
    reportWording: 'Gaps between the door leaf and frame measured outside permitted tolerances, allowing passage of smoke.',
    rectification: 'Adjust or replace the leaf, frame or seals to bring gaps within tolerance.',
    quoteItems: [{ description: 'Labour — door adjustment', unit: 'hr', qtyPerDefect: 2 }],
  },
  {
    code: 'DOR-FD-004', system: 'door', component: 'Fire door', defect: 'Tag missing',
    severity: 'low',
    reportWording: 'Fire door identification tag missing, so the door’s rating and certification cannot be verified on site.',
    rectification: 'Establish the door’s certification and fit a replacement tag.',
    quoteItems: [{ description: 'Replacement tag', unit: 'ea', qtyPerDefect: 1 }],
  },

  // ======================================================== GAS
  {
    code: 'GAS-CYL-001', system: 'gas', component: 'Cylinder', defect: 'Weight or pressure below tolerance',
    severity: 'critical',
    reportWording: 'Suppression cylinder weight or pressure measured below the permitted tolerance, indicating agent loss.',
    rectification: 'Remove the cylinder for refilling or replacement and reinstate with correct charge.',
    quoteItems: [{ description: 'Cylinder refill or exchange', unit: 'ea', qtyPerDefect: 1 }, { description: 'Labour', unit: 'hr', qtyPerDefect: 2 }],
    photoRequired: true,
  },
  {
    code: 'GAS-REL-001', system: 'gas', component: 'Release mechanism', defect: 'Failed to operate on test',
    severity: 'critical',
    reportWording: 'Release mechanism did not operate when tested in the safe condition.',
    rectification: 'Replace or repair the actuator and re-test the release circuit end to end.',
    quoteItems: [{ description: 'Replacement actuator', unit: 'ea', qtyPerDefect: 1 }, { description: 'Labour', unit: 'hr', qtyPerDefect: 2 }],
  },

  // ======================================================== ELECTRICAL
  {
    code: 'ELE-RCD-001', system: 'electrical', component: 'RCD', defect: 'Failed to trip within required time',
    severity: 'high',
    reportWording: 'Residual current device did not trip within the required time at its rated residual current.',
    rectification: 'Replace the RCD and re-test trip time and trip current.',
    quoteItems: [{ description: 'Replacement RCD', unit: 'ea', qtyPerDefect: 1 }, REPLACE_LABOUR, TEST_LABOUR],
  },
  {
    code: 'ELE-SWB-001', system: 'electrical', component: 'Switchboard', defect: 'Missing or incorrect labelling',
    severity: 'medium',
    reportWording: 'Switchboard circuit labelling missing or does not match the circuits it identifies.',
    rectification: 'Verify each circuit and fit correct, durable labelling.',
    quoteItems: [{ description: 'Labour — circuit identification and labelling', unit: 'hr', qtyPerDefect: 2 }],
  },
  {
    code: 'ELE-SWB-002', system: 'electrical', component: 'Switchboard', defect: 'Exposed live parts',
    severity: 'critical',
    reportWording: 'Live parts accessible at the switchboard due to missing escutcheon, blanking plate or cover.',
    clientWording: 'Live electrical parts are exposed at a switchboard and could be touched.',
    rectification: 'Fit the missing covers or blanking plates and confirm no live parts remain accessible.',
    quoteItems: [{ description: 'Blanking plates / escutcheon', unit: 'lot', qtyPerDefect: 1 }, REPLACE_LABOUR],
    photoRequired: true,
  },
];

/** Index for fast lookup by code. */
const BY_CODE = new Map(DEFECT_LIBRARY.map((d) => [d.code, d]));

export function defectByCode(code: string): DefectCode | undefined {
  return BY_CODE.get(code);
}

export function defectsForSystem(system: SystemKind): DefectCode[] {
  return DEFECT_LIBRARY.filter((d) => d.system === system);
}

export function defectComponents(system: SystemKind): string[] {
  return [...new Set(defectsForSystem(system).map((d) => d.component))];
}

export function searchDefects(query: string): DefectCode[] {
  const q = query.trim().toLowerCase();
  if (!q) return DEFECT_LIBRARY;
  return DEFECT_LIBRARY.filter(
    (d) =>
      d.code.toLowerCase().includes(q) ||
      d.defect.toLowerCase().includes(q) ||
      d.component.toLowerCase().includes(q) ||
      d.reportWording.toLowerCase().includes(q),
  );
}

export const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};
