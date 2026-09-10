# What the reviewer said about the method statements

Ten safe work method statements ship in `src/seed/swms/templates.json`. Each was
drafted, read by a reviewer whose job was to refuse to sign it, and corrected.
This directory holds the **second** read — the check on whether those
corrections actually landed.

The answer was no. Five statements were read again and every one came back
unsignable; five were never reached, because the run stopped. Nothing here is a
paperwork complaint. The reviewer found hazards the statements name and then
never control:

- **live-testing** — "Contact with a live luminaire, busway or a sprinkler head
  while reaching" is listed as a hazard and nothing in fourteen controls answers
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

1. Correct the five reviewed statements against the `fix` field in each file.
2. Review the five that were never read: `hydrant-flow`,
   `extinguisher-cylinders`, `traffic-lone`, `asbestos-silica`,
   `sprinkler-wet`.
3. Set `review.cleared` to `true` only where a reviewer would sign the corrected
   statement, and the signature gate opens on its own.
