/**
 * Schema v35 — the Part C calibration date the form showed and never kept.
 *
 * Part C prints "Calibrated: __/__/__" twice on one line: once for a
 * mechanical flow measuring device and once for an electromagnetic one. The
 * screen has always offered both boxes, the renderer has always printed them,
 * and nothing ever stored them. A technician typed the date, watched it appear,
 * generated the PDF — and the next time the form was opened the boxes were
 * empty, so a reprint of a form already issued to an occupier came out saying
 * the device had no calibration date.
 *
 * Which is the worst shape a defect of this kind can take. A field that never
 * worked gets reported; one that works until you look away does not.
 *
 * One nullable TEXT column holding the same `{ mechanical?, electromagnetic? }`
 * map the domain has carried all along, beside the devices and flowTest
 * columns that are stored the same way. Absent reads back as nobody having
 * typed a date, which is what every form already on a phone means.
 */
export const MIGRATION_V35 = `
  ALTER TABLE form_72 ADD COLUMN flowDeviceCalibrated TEXT;
`;
