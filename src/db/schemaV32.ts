/**
 * Schema v32 — what the crew took off, what they judged, and where it was sent.
 *
 * Four columns on the safe work method statement, and each one exists because
 * a crew on a site had no honest way to say something.
 *
 * **notApplicable.** A statement covers an activity in general; a day is one
 * instance of it. The confined-space statement has a step about rigging a
 * tripod and a retrieval line, and a booster pit you stand beside and reach
 * into does not need one. Until now a crew facing a step that did not apply
 * had two choices, and both were wrong: tick it, and the document says they
 * read and followed something they did not, on a page an inspector reads; or
 * leave it, and the signature is blocked for ever. Taking it off is the third,
 * and it prints as "not applicable" rather than disappearing.
 *
 * **crewRisk.** Every step carries a risk rating from whoever wrote and
 * reviewed the statement. That is the method's rating, arrived at in an
 * office. This is the crew's, arrived at in the plant room, and it is stored
 * beside the other rather than replacing it — they are not the same claim, and
 * a disagreement between them is worth more than either alone.
 *
 * **emailedAt and emailedTo.** A statement that exists only on the phone of
 * the person who signed it cannot be produced when it is asked for, which is
 * months later and after something has gone wrong. The office gets a copy, and
 * the record says when and to which of the two inboxes — so "did that one ever
 * come through" has an answer on the phone as well as in the inbox.
 *
 * All four hold JSON or text and default to null, so every statement already on
 * a phone reads back exactly as it did before: an absent column is an empty
 * list, an empty map, and a statement nobody has emailed.
 */
export const MIGRATION_V32 = `
  ALTER TABLE swms ADD COLUMN notApplicable TEXT;
  ALTER TABLE swms ADD COLUMN crewRisk TEXT;
  ALTER TABLE swms ADD COLUMN emailedAt TEXT;
  ALTER TABLE swms ADD COLUMN emailedTo TEXT;
`;
