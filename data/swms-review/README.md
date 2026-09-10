# What the reviewer said about the method statements

Ten safe work method statements ship in `src/seed/swms/templates.json`. Each was
drafted, read by a reviewer whose job was to refuse to sign it, and corrected.
This directory holds the read that came **after** that — the check on whether
the corrections landed, and, for the five it did not reach the first time, the
first proper read of them at all.

Every one of the ten came back refused. Nothing here is a paperwork complaint.
The fault the reviewers found again and again is the same, and it is the worst
one a method statement can have: **a hazard the document names and then never
controls.** A crew that reads it believes that hazard is handled.

- **live-testing** — "Contact with a live luminaire, busway or a sprinkler head
  while reaching" is a listed hazard and nothing in fourteen controls answers
  it, while the statement's own elimination control sends a technician up a
  telescopic pole into that same ceiling space. Crush between an EWP basket and
  the structure overhead is never named at all.
- **hot-work** — no mention of gaseous or special-hazard suppression anywhere,
  in a document about striking arcs inside plant rooms.
- **heights** — the emergency section has no response for electric shock, in a
  statement whose hazards include contact with lighting circuits.
- **electrical** — respirable crystalline silica is not named while the crew
  drills concrete; a technician is put in a pump room and told to verify
  auto-start, with none of a diesel pumpset's hazards named.
- **confined-space** — no ignition-source control for a flammable atmosphere the
  work itself creates.
- **hydrant-flow** — "Unrestrained booster hose at pressure" is a named hazard
  with no restraint control against it, on the highest-pressure hose of the day.
  The diesel rescue procedure rests on stopping the engine from outside a room
  the document admits may have no external stop.
- **extinguisher-cylinders** — oxygen displacement is named and every control
  stops at the bay wall; the retrieval line is required only "wherever the
  access shape allows one"; discharge noise is named in a step with no hearing
  protection in it.
- **traffic-lone** — a lone worker is sent to isolation points the step names
  and never reaches; pump room noise is answered by earplugs alone; the lift
  going to fire mode with the technician on B3 is named and never controlled.
- **asbestos-silica** — "Sprinkler pipe, gas line, hydraulic riser or comms
  behind the sheet" is named and no control addresses any of them; friable
  lagging beside the hole has no control because every asbestos control keys off
  drilling *into* it; noise appears in none of the twelve steps.
- **sprinkler-wet** — electric shock is named twice and answered never, in a
  room where hundreds of litres of black water go across the floor past a wet
  vac and a task light that were plugged in first.

Each file carries the reviewer's `verdict`, and a `blocking` array of
`{field, problem, fix, severity}`. The `fix` field is what the correction round
should be worked from — it is specific, and it cites the instrument.

## What the app does with this

`src/seed/swms/templates.json` carries a short `review` block per statement,
generated from these files. `mergeSwms` collects the uncleared ones onto
`MergedSwms.notCleared`, `validateSwms` raises a blocking issue for each, and
the record screen shows them. **A statement nobody has cleared cannot be
signed.** A missing `review` block counts as not cleared — silence is not a
clearance.

The statements are still worth reading and briefing a crew from; they are
substantially right and far better than the nothing that came before. They are
not worth signing, because a signature says the document describes how the work
will actually be done.

## Outstanding

1. Correct each statement against the `fix` field of every finding filed against
   it — fatal, serious and minor.
2. Have each corrected statement read cold by a reviewer who has not seen the
   correction, and file that read here in place of this one.
3. Set `review.cleared` to `true` only where a reviewer would sign the corrected
   statement, and the signature gate opens on its own.

`src/__tests__/swmsReview.test.ts` holds the seed and these files together, so a
statement cannot be marked cleared while a filed review here refuses it.
