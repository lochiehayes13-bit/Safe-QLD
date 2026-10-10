/**
 * Schema v37 — which parts somebody actually answered.
 *
 * Every part result on this form starts as 'na', because a form has to start
 * somewhere and a part nobody has reached is not a pass or a fail. The
 * consequence is that "the technician marked Part B not applicable" and
 * "nobody ever opened Part B" are the same stored value, and so they print the
 * same: the department's form has no way to say the difference either, and the
 * page says N/A for both.
 *
 * For the printed form that is tolerable — N/A is a legitimate answer and the
 * department accepts it. For the screen it is not, because the one question a
 * technician needs answered before they sign is "is there anything on this
 * form I have not actually looked at?", and with one value meaning both
 * things, nothing can answer it. An outstanding-parts list built on the stored
 * result alone would keep naming parts somebody had deliberately marked N/A,
 * and a list that cries wolf is a list people stop reading.
 *
 * So a part is recorded here the moment somebody answers it — including when
 * the answer is "not applicable". The column holds a JSON array of the part
 * keys: ["A","C","B"]. Absent, which is every form written before this
 * migration, falls back to reading the parts themselves, which is what the app
 * did before and is no worse than it was.
 *
 * It changes nothing that prints. The department's form has no field for it
 * and the page never mentions it; this exists so the screen can tell a
 * technician what they have not looked at yet.
 */
export const MIGRATION_V37 = `
  ALTER TABLE form_72 ADD COLUMN answeredParts TEXT;
`;
