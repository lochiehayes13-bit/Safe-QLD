import type { FlowDeviceKind, TestDevice } from '@/domain/form72';

/**
 * Safe QLD's own test equipment, so Part C is a tap rather than a typing job.
 *
 * Part C is the same two meters on nearly every hydrant form the company
 * raises, and every time it was typed again: a serial number, a date, a
 * certificate reference and a correction factor, four fields where one of them
 * invalidates every pressure on the page if it is typed wrong. A serial number
 * mistyped reads exactly like a serial number, and the form it is on is signed.
 *
 * So the equipment is held here, transcribed once from the manufacturer's
 * certificates, and added to a form whole. What is added is still editable —
 * the certificate date moves when a meter is serviced, and a technician who has
 * the new certificate in their hand should not have to wait for a release — but
 * nobody has to type it from memory at a booster.
 *
 * This is the company's own kit, not a general catalogue. A device a technician
 * brings that is not on this list is added by hand, which is what the blank
 * device row is for.
 */

/** A device somebody can add to Part C in one tap. */
export interface DevicePreset {
  id: string;
  /** What the chip says: short enough for a phone, specific enough to pick. */
  label: string;
  /** One line under the chip, so two similar meters are distinguishable. */
  detail: string;
  /**
   * The Part C flow-measuring-device tick this one belongs under, where the
   * certificate establishes it. Absent where it does not — the three ticks are
   * a claim about how the device measures, and a tick put on by guesswork is
   * worse than a blank the technician fills in knowingly.
   */
  flowDeviceKind?: FlowDeviceKind;
  /**
   * Why the kind is absent, where it is. Shown on the screen, so the technician
   * knows it is theirs to answer rather than something the app forgot.
   */
  flowDeviceKindNote?: string;
  /** The device as it goes onto the form, minus the slot the form gives it. */
  device: Omit<TestDevice, 'slot'>;
}

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
 */
const FLOWTECH_MODEL = 'Flowtech Omega Series inline meter, DN80';

const flowtech = (serial: string, report: string): DevicePreset => ({
  id: `flowtech-${serial.toLowerCase()}`,
  label: `Inline meter ${serial}`,
  detail: 'Flowtech Omega Series DN80 · certified 18/07/2026 · +0.35%',
  /*
   * No tick. The certificate calls the device "microprocessor based" and says
   * it handles slurries, salt water and aggregate to 15 mm without affecting
   * its accuracy, which rules out a mechanical impeller and points at an
   * electromagnetic element — but it never says electromagnetic, and the three
   * Part C ticks are a statement about the instrument on a document somebody
   * signs. An inference is not good enough for that, so the technician ticks
   * it and the screen says why it is being asked.
   */
  flowDeviceKindNote: 'The certificate does not name the measuring element, so the Orifice / '
    + 'Mechanical / Electro magnetic tick is yours to make.',
  device: {
    serialNumber: serial,
    model: FLOWTECH_MODEL,
    dateCalibrated: '2026-07-18',
    calibrationCertificate: report,
    correctionFactor: '+0.35 %',
    calibrationBasis: 'service-life',
    digitalReader: true,
    /*
     * Face size and increments are deliberately absent. They describe a
     * pressure gauge's dial, and this is a flow meter — there is no 100 mm face
     * and no kPa increment on it. Left absent they print as not recorded, which
     * on a flow meter row is the honest answer; filled with anything they would
     * read as a gauge specification somebody measured.
     */
  },
});

export const DEVICE_PRESETS: DevicePreset[] = [
  flowtech('SQF-001', 'CR-SQF-001-IN-01'),
  flowtech('SQF-002', 'CR-SQF-002-IN-01'),
];

/** A preset by its id, for a screen that stores the choice rather than the device. */
export function devicePreset(id: string): DevicePreset | undefined {
  return DEVICE_PRESETS.find((p) => p.id === id);
}

/**
 * The presets not already on a form, so a chip cannot add the same meter twice.
 *
 * Matched on serial number rather than on the preset id, because a device typed
 * by hand with the same serial is the same meter — adding it again would put
 * one instrument in two Part C columns and make the form look like a test run
 * with twice the equipment it had.
 */
export function unusedDevicePresets(devices: readonly TestDevice[]): DevicePreset[] {
  const held = new Set(devices.map((d) => d.serialNumber.trim().toUpperCase()).filter(Boolean));
  return DEVICE_PRESETS.filter((p) => !held.has(p.device.serialNumber.toUpperCase()));
}
