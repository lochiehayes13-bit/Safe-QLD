/**
 * Schema v34 — the six things the department's Form 72 never asks for.
 *
 * The printed form has no box for any of these, and the test is not a record
 * without them. They print on an attachment page after Part I rather than
 * inside a part, so a reader can always tell the department's form from what
 * we added to it.
 *
 * **owner and ownerContact.** Part H obliges somebody to be told about a
 * critical defect, and the form never says who. "The owner" on the day is a
 * name and a number in a technician's phone; a year later it is whoever still
 * remembers. Stored beside the test, the notice has an addressee on the
 * document that records the defect.
 *
 * **buildingClassification.** Class 2 to 9 decides which parts of AS 2419.1
 * and AS 2118.1 the system was ever meant to meet, so it decides what a pass
 * means. Left off, the next technician reads our pass without knowing what it
 * was measured against.
 *
 * **technician and qualification.** The licensee signs Part I; the person who
 * climbed the roof is often somebody else, and on a five-yearly that team is
 * three people over two days. The signature says who takes responsibility, not
 * who did the work, and only one of those two facts was being kept.
 *
 * **defects.** A JSON list of {description, critical}. Part H asks whether
 * critical defects were identified and then sends the details to the
 * licensee's report — a separate document that routinely does not follow the
 * form. Holding the list here means the answer to Part H's first question can
 * be checked against the defects actually found, which is the contradiction
 * validateForm72 now refuses to let somebody sign.
 *
 * All six are nullable text, so every form already on a phone reads back
 * exactly as it did: an absent column is an unnamed owner and an empty defect
 * list.
 */
export const MIGRATION_V34 = `
  ALTER TABLE form_72 ADD COLUMN owner TEXT;
  ALTER TABLE form_72 ADD COLUMN ownerContact TEXT;
  ALTER TABLE form_72 ADD COLUMN buildingClassification TEXT;
  ALTER TABLE form_72 ADD COLUMN technician TEXT;
  ALTER TABLE form_72 ADD COLUMN qualification TEXT;
  ALTER TABLE form_72 ADD COLUMN defects TEXT;
`;
