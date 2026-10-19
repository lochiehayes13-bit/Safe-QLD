import { deviceSlotName, type FlowDeviceKind, type TestDevice } from '@/domain/form72';

/**
 * Safe QLD's own test equipment, so Part C is a tap rather than a typing job.
 *
 * Part C is the same two meters and one gauge on nearly every hydrant form the
 * company raises, and every time it was typed again: a serial number, a date,
 * a certificate reference and a correction factor, four fields where one of
 * them invalidates every pressure on the page if it is typed wrong. A serial
 * number mistyped reads exactly like a serial number, and the form it is on is
 * signed.
 *
 * So the equipment is held here, transcribed once from what the company holds
 * for it, and added to a form whole. What is added is still editable:
 * the certificate date moves when a meter is serviced, and a technician who has
 * the new certificate in their hand should not have to wait for a release — but
 * nobody has to type it from memory at a booster.
 *
 * This is the company's own kit, not a general catalogue. A device a technician
 * brings that is not on this list is added by hand, which is what the blank
 * device row is for.
 */

/** A device somebody can add to Part C in one tap. */
export type DevicePreset = (
  | (DeviceKindClaim & { device: { kind: 'flow-meter' } })
  | (GaugeClaim & { device: { kind: 'gauge' } })
) & {
  id: string;
  /** What the chip says: short enough for a phone, specific enough to pick. */
  label: string;
  /** One line under the chip, so two similar meters are distinguishable. */
  detail: string;
  /** The device as it goes onto the form, minus the slot the form gives it. */
  device: Omit<TestDevice, 'slot'>;
};

/**
 * What a preset says about Part C's three ticks, which is one of two things.
 *
 * A union rather than two optional fields, so a preset cannot be added with
 * neither. The silent case is the dangerous one: a kind left off and no reason
 * given looks on the screen exactly like a question the app forgot to ask, and
 * the technician scrolls past it.
 */
export type DeviceKindClaim =
  /**
   * The documents establish which tick it is, so the form can carry it.
   */
  | { flowDeviceKind: FlowDeviceKind; flowDeviceKindNote?: string }
  /**
   * They do not. The three ticks are a claim about how the instrument
   * measures, and a tick put on by inference is worse than a blank somebody
   * fills in knowingly — so the note says what is known and what is not, and
   * the technician answers it once for that meter.
   */
  | { flowDeviceKind?: undefined; flowDeviceKindNote: string };

/**
 * A pressure gauge, which the three flow-device ticks do not describe at all.
 * Named rather than left as a preset with no claim, so the silent case above
 * still cannot be written by accident.
 */
export type GaugeClaim = { gauge: true; flowDeviceKind?: undefined; flowDeviceKindNote?: undefined };

/**
 * The transcription source, named so the next person can check it.
 *
 * Both certificates are Flowtech "Performance | Accuracy | Calibration Test
 * Report" sheets issued to SAFE QLD FIRE, certified by Lawrence Coomber and
 * dated 18 July 2026. They are filed as CR-SQF-001.pdf and CR-SQF-002.pdf.
 */
export const DEVICE_PRESET_SOURCE = 'Transcribed from the Flowtech Omega Series '
  + 'Performance | Accuracy | Calibration Test Reports issued to Safe QLD Fire, certified '
  + '18 July 2026 by Lawrence Coomber (CR-SQF-001.pdf, CR-SQF-002.pdf).';

/**
 * The meters' calibration, in the certificate's own terms.
 *
 * "Meter calibration is fixed in software, and the device will operate within
 * the specified MMPE accuracy range for its service life, excepting if a fault
 * or damage has occurred." That is why these carry a service-life basis rather
 * than the twelve-month interval a pressure gauge gets: on the interval rule a
 * form raised after 18 July 2027 would be refused for a reason the certificate
 * contradicts. The claim is the manufacturer's and the form prints it as such.
 *
 * The certificate's claim is conditional and the two conditions are on the
 * printed page rather than buried here, because both are things only the person
 * holding the meter can answer: it holds "excepting if a fault or damage has
 * occurred", and it says "a periodic meter calibration service and
 * recertification may be stipulated by Councils or other authorities". A basis
 * printed without them would read as unconditional.
 */
const FLOWTECH_MODEL = 'Flowtech Omega Series inline meter, DN80';

/** The certificate's issuer, signatory and accuracy claim, as the page prints them. */
const FLOWTECH_ISSUER = 'Flowtech Water Meters';
const FLOWTECH_CERTIFIER = 'Lawrence Coomber';
const FLOWTECH_ACCURACY = 'MMPE ±2 % of full scale, near Class 2 water meter equivalence';

const flowtech = (serial: string, report: string): DevicePreset => ({
  id: `flowtech-${serial.toLowerCase()}`,
  label: `Inline meter ${serial}`,
  detail: 'Flowtech Omega Series DN80 · certified 18/07/2026 · +0.35%',
  /*
   * No tick, and the documents are the reason rather than an oversight.
   *
   * Two readings of the same papers reach opposite answers, which is how I
   * know neither is established:
   *
   * FOR Electro magnetic — the certificate warrants "Council quarry slurries",
   * "bedding sand and aggregate to 15 mm" and "ice debris and suspended
   * solids" "without causing any damage to the device internal parts, or
   * variation in the metering accuracy". Nothing with a rotor in the bore
   * survives that, and a magnetic element's output is independent of density
   * and viscosity, which is what lets one accuracy claim cover media from
   * potable water to effluent.
   *
   * FOR Mechanical — the manufacturer's own service document says "the MSP
   * mechanical parts, have a design life of up to 20+ years service" and that
   * the one service it ever needs is a battery in the "electronic metering
   * module". A ten-year battery driving an LCD is not a magnetic meter's power
   * budget; its excitation coils are the reason those are mains or
   * short-life-battery instruments. The certificate's accuracy is stated as
   * "near equivalence of a Class 2 Water Meter", which is cold-water-meter
   * language, and the whole assembly is rated intrinsically safe Ex i.m.n.
   *
   * Neither document names the measuring element. Not one of the words
   * electromagnetic, magnetic, ultrasonic, turbine, rotor, impeller or orifice
   * appears anywhere in either of them, which I checked rather than assumed.
   *
   * So the app does not tick it. Part C's three boxes are a statement about
   * the instrument on a page a licensee signs, and a tick the app inferred
   * prints identically to one a technician made knowingly. The technician
   * answers it once for this meter — see src/db/deviceKindRepo.ts — and is
   * never asked again.
   */
  flowDeviceKindNote: 'Neither the certificate nor Flowtech\u2019s service document names the '
    + 'measuring element, and they point different ways: the warranted media (quarry slurry, '
    + 'aggregate to 15 mm) suit an electromagnetic meter, while "mechanical parts" with a 20-year '
    + 'life, a 10-year battery and Class 2 Water Meter accuracy suit a mechanical one. So this '
    + 'tick is yours. Answer it once and every later form with this serial fills it in.',
  device: {
    serialNumber: serial,
    kind: 'flow-meter',
    model: FLOWTECH_MODEL,
    dateCalibrated: '2026-07-18',
    calibrationCertificate: report,
    /*
     * The certificate's figure, with its sense spelled out.
     *
     * It states "MM Error: + 0.35 %" — the meter's mean measured error, which
     * by the convention every calibration report uses is indicated minus true:
     * a positive error is a meter reading high. Part C asks for a correction
     * factor, and a correction is the error with its sign reversed. Printed
     * as a bare "+0.35 %" the page handed a reader the error as though it
     * were the correction, and applying it would move a reading the wrong
     * way. So both facts print, each named: what the certificate measured,
     * and what to apply.
     */
    correctionFactor: 'Meter error +0.35 % at certification (reads high); correction −0.35 %',
    calibrationBasis: 'service-life',
    digitalReader: true,
    issuedBy: FLOWTECH_ISSUER,
    certifiedBy: FLOWTECH_CERTIFIER,
    accuracy: FLOWTECH_ACCURACY,
    /*
     * Face size and increments are deliberately absent. They describe a
     * pressure gauge's dial, and this is a flow meter — there is no 100 mm face
     * and no kPa increment on it. `kind` is what lets the page answer those two
     * rows "N/A for a flow meter" rather than printing them in red as readings
     * somebody failed to record.
     */
  },
});

/**
 * The company's pressure gauge: bought new and calibrated when it was picked
 * up on 2 October 2026, on the twelve-month interval every gauge is judged by.
 *
 * Its serial number and certificate reference are not transcribed here. They
 * are typed on the first form it goes on, and every later form carries them:
 * currentPresetDevice finds that form's column by presetId, because until
 * somebody types it there is no serial to recognise the gauge by. A form will
 * not issue with the serial blank, which is the point: a gauge nobody can
 * identify is not an instrument the pressures can be traced to.
 */
/** The gauge's preset id, which is how a form's column is recognised as it. */
export const COMPANY_GAUGE_ID = 'company-gauge';

const COMPANY_GAUGE: DevicePreset = {
  id: COMPANY_GAUGE_ID,
  gauge: true,
  label: 'Pressure gauge',
  detail: 'New unit · calibrated 02/10/2026 · type its serial once',
  device: {
    serialNumber: '',
    kind: 'gauge',
    dateCalibrated: '2026-10-02',
  },
};

export const DEVICE_PRESETS: DevicePreset[] = [
  flowtech('SQF-001', 'CR-SQF-001-IN-01'),
  flowtech('SQF-002', 'CR-SQF-002-IN-01'),
  COMPANY_GAUGE,
];

/** A preset by its id, for a screen that stores the choice rather than the device. */
export function devicePreset(id: string): DevicePreset | undefined {
  return DEVICE_PRESETS.find((p) => p.id === id);
}

/**
 * The preset's device as it should go onto a form today: from what is
 * transcribed here, unless this phone has seen more since.
 *
 * A meter comes back from a repair with a new certificate, and the technician
 * holding it edits the date and report number on that day's form. Every later
 * form offered the preset again, with the superseded certificate on it, and
 * the "used before" list dropped the corrected row because its serial was a
 * preset's. So a remembered row for a preset's serial with a later calibration
 * date is the current certificate, and it is what goes on, laid over the
 * preset so a field the technician left blank keeps the transcribed value.
 * `recertified` carries the date, so the chip can say it is not the
 * certificate in the code.
 *
 * The gauge has no serial in the code, so the last form it was on is what it
 * carries: the serial, certificate and date typed there.
 */
export function currentPresetDevice(
  preset: DevicePreset,
  remembered: readonly { device: Omit<TestDevice, 'slot'> }[] = [],
): { device: Omit<TestDevice, 'slot'>; recertified?: string } {
  const key = preset.device.serialNumber.trim().toUpperCase();
  // A meter is its serial: a hire meter typed over its card is another
  // instrument. The gauge has no serial here, so its column is how it is known.
  const same = key
    ? remembered.filter((r) => r.device.serialNumber?.trim().toUpperCase() === key)
    : remembered.filter((r) => r.device.presetId === preset.id);
  const base = { ...preset.device, presetId: preset.id };
  // Whether this meter reads pressure is a fact about the meter, answered on
  // its card; the latest form's answer carries, whatever the certificate date.
  const answered = same.find((r) => typeof r.device.readsPressure === 'boolean');
  const readsPressure = answered ? { readsPressure: answered.device.readsPressure } : {};
  const later = key
    ? same.find((r) => !!r.device.dateCalibrated
      && !!preset.device.dateCalibrated
      && r.device.dateCalibrated > preset.device.dateCalibrated)
    : same[0];
  if (!later) return { device: { ...base, ...readsPressure } };
  const over = Object.fromEntries(
    Object.entries(later.device).filter(([, v]) => v !== undefined && v !== ''),
  ) as Partial<Omit<TestDevice, 'slot'>>;
  const from = preset.device.dateCalibrated;
  const moved = !!later.device.dateCalibrated && !!from && later.device.dateCalibrated > from;
  return {
    device: { ...base, ...over, ...readsPressure, presetId: preset.id },
    ...(moved ? { recertified: later.device.dateCalibrated } : {}),
  };
}

/**
 * The equipment a new form starts with.
 *
 * Part C is the company's two meters and its gauge on nearly every hydrant
 * form it raises, and the ask was that the calibration data be on every form
 * without a tap. So the presets go on at creation, in the department's first
 * columns, with whatever this phone has seen since. A sprinkler-only form gets
 * the meters too (the system is not known when the form is made) and takes
 * them off with one tap each; validateForm72 says so if they are left on.
 */
export function seedDevices(
  remembered: readonly { device: Omit<TestDevice, 'slot'> }[] = [],
): TestDevice[] {
  const out: TestDevice[] = [];
  for (const preset of DEVICE_PRESETS) {
    out.push({ slot: deviceSlotName(out), ...currentPresetDevice(preset, remembered).device });
  }
  return out;
}

/**
 * The presets not already on a form, so a chip cannot add the same meter twice.
 *
 * Matched on serial number as well as on the preset id, because a device typed
 * by hand with the same serial is the same meter: adding it again would put one
 * instrument in two Part C columns and make the form look like a test run with
 * twice the equipment it had. The gauge has no serial in the code, so for it
 * the id is the only match.
 */
export function unusedDevicePresets(devices: readonly TestDevice[]): DevicePreset[] {
  const held = new Set(devices.map((d) => d.serialNumber.trim().toUpperCase()).filter(Boolean));
  const ids = new Set(devices.map((d) => d.presetId).filter(Boolean));
  return DEVICE_PRESETS.filter((p) => (p.device.serialNumber
    ? !held.has(p.device.serialNumber.toUpperCase())
    : !ids.has(p.id)));
}

/**
 * Equipment worth offering on this form, out of what the phone remembers.
 *
 * Two things are filtered out and both matter. An instrument already on the
 * form, matched by serial, because adding it twice puts one meter in two Part
 * C columns and makes the form read as a test run with twice the equipment it
 * had — the same rule unusedDevicePresets applies. And the presets themselves,
 * because they have their own chips: offering the company's own flow meter in
 * two places, once from its certificate and once from however it was typed
 * last March, is two sources for one fact and they can disagree. The company
 * gauge is recognised by its column's preset id, since it has no serial here.
 */
export function offerableDevices<T extends { device: Omit<TestDevice, 'slot'> }>(
  remembered: readonly T[],
  onForm: readonly TestDevice[],
): T[] {
  const held = new Set(onForm.map((d) => d.serialNumber.trim().toUpperCase()).filter(Boolean));
  const preset = new Set(DEVICE_PRESETS.map((p) => p.device.serialNumber.trim().toUpperCase()).filter(Boolean));
  // Only the presets with no serial are known by id; a meter is known by serial.
  const presetIds = new Set(DEVICE_PRESETS.filter((p) => !p.device.serialNumber).map((p) => p.id));
  return remembered.filter((r) => {
    const key = r.device.serialNumber?.trim().toUpperCase();
    return !!key && !held.has(key) && !preset.has(key)
      && !(r.device.presetId && presetIds.has(r.device.presetId));
  });
}
