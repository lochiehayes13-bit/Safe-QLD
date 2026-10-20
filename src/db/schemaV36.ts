/**
 * Schema v36 — which of Part C's three boxes a particular meter belongs under,
 * answered once per instrument instead of once per form.
 *
 * Part C asks whether the flow measuring device is an Orifice, a Mechanical or
 * an Electro magnetic one. That is not a fact about the test: it is a fact
 * about the instrument in the back of the ute, and it will be the same answer
 * on every form that meter ever appears on. Asking it per form means asking a
 * technician the same question a hundred times and getting a hundred chances
 * to answer it differently on documents a licensee signs.
 *
 * So it is stored against the serial number. The first person who actually
 * knows — because they rang the manufacturer, or read a plate on the body —
 * answers once, and every later form with that serial fills itself in and says
 * where the answer came from.
 *
 * **Why answeredBy and basis are columns and not comments.** This is a
 * statement about an instrument on a statutory form, and the two questions
 * anybody will ask of it later are who said so and how they knew. A stored
 * answer with neither is indistinguishable from a guess, and a guess is the
 * one thing this table exists to avoid: the app will not tick these boxes
 * itself, because the certificates for our own Flowtech meters do not name the
 * measuring element and a tick put on by inference is worse than a blank
 * somebody fills in knowingly.
 *
 * Keyed on the serial number upper-cased, because a serial typed in lower case
 * is the same meter.
 */
export const MIGRATION_V36 = `
  CREATE TABLE IF NOT EXISTS device_kind (
    serialNumber TEXT PRIMARY KEY,
    kind         TEXT NOT NULL,
    answeredBy   TEXT,
    basis        TEXT,
    answeredAt   TEXT NOT NULL
  );
`;
