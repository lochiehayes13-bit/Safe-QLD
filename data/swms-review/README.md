# What the reviewers said about the method statements

Ten safe work method statements ship in `src/seed/swms/templates.json`. Each was
drafted, read by a reviewer whose job was to refuse to sign it, and corrected.
This directory holds the reads that came after that, one file per statement,
each replaced when a newer read of that statement lands.

**Every finding filed here has now been answered.** All 87 of them, across all
ten statements, 17 fatal — not just the fatal ones. The hazards that were named
and left uncontrolled carry controls; the controls that instructed what other
controls prohibited have been reconciled; the ratings that could not be
reproduced from the document's own key have been corrected or the key has.

**No statement here is cleared, and none should be signed.** A correction is
not a clearance. The person who makes a correction is the worst possible judge
of whether it worked, because they know what they meant and so they read what
they meant. What each statement is waiting on is a cold read: somebody who did
not make the correction reading it the way a crew would, and saying they would
sign it. Until that has happened `review.cleared` stays false and the signature
gate stays shut.

The fault that keeps coming back, in every document and every round, is the same
one, and it is the worst a method statement can have: **a hazard the document
names and then never controls.** A crew that reads it believes that hazard is
handled. Second is a hazard of the work that the document never names at all —
harder to see, because nothing on the page is wrong.

## What the last read found, and what the correction answered

The table below is the last filed read, kept as it was: it is the record the
correction was worked from, and the "one that matters" column is the finding
that would have hurt somebody. Each of those, and every other finding in the
file beside it, has been answered in the shipped statement. The column is
therefore a history of what was wrong, not a description of what is.

| Statement | Blocking | Fatal | The one that matters most |
| --- | --- | --- | --- |
| `live-testing` | 11 | 1 | The real-fire procedure restores the brigade signal and nothing else. By step 7 the zones are isolated, every ancillary output is off and the gaseous release is locked at the cylinder — so the doors stay held open, the shutters stay up, stair pressurisation and smoke exhaust do not start and the lifts do not recall — and the crew is never told to put any of it back. |
| `hot-work` | 8 | 1 | "Asbestos gasket or lagging on old pipework" is a named hazard in a step of twelve controls, none of which mentions asbestos, while the work grinds and cuts that pipework. |
| `heights` | 9 | 0 | No response anywhere for an unarrested fall, in a statement whose emergency section answers suspension trauma, shock, heat and crush. Overhead lines and solar arrays are named in step 1 and controlled in none of its seven controls. |
| `electrical` | 6 | 0 | The statement says in its own words that opening a panel with the mains block exposed *is* energised electrical work, and then does not carry that through to who may do it. Isolating rooftop PV is now mandatory and the trip to the roof to do it is controlled nowhere. |
| `confined-space` | 7 | 1 | The rescue this document guarantees does not exist for a horizontal space, and the document never says so: every entry is committed to "on-site no-entry retrieval by the standby on the rigged winch", which cannot be rigged through a side hatch. |
| `hydrant-flow` | 9 | 2 | "Unrestrained booster hose at pressure" is named with no restraint control, on the highest-pressure hose of the day. The diesel rescue rests on stopping the engine from outside a room the statement admits may have no external stop. |
| `extinguisher-cylinders` | 10 | 3 | Oxygen displacement is named "in the bay or in any low point it drains into" and every control stops at the bay wall. A retrieval line is required "wherever the access shape allows one" — so where it does not, there is none. |
| `traffic-lone` | 7 | 3 | A lone worker is sent to isolation points the step names and never reaches; pump room noise is answered by earplugs alone; the lift going to fire mode with the technician on B3 is named and not controlled. |
| `asbestos-silica` | 13 | 4 | "Sprinkler pipe, gas line, hydraulic riser or comms behind the sheet" is named and none of them is addressed. Friable lagging beside the hole has no control, because every asbestos control keys off drilling *into* it. Noise appears in none of the twelve steps. |
| `sprinkler-wet` | 7 | 2 | Electric shock is named twice and answered never, in a room where hundreds of litres of black water cross the floor past a wet vac and a task light the document had the crew plug in first. |

Each file carries the reviewer's `verdict`, and a `blocking` array of
`{field, problem, fix, severity}`. The `fix` field is what the next correction
round should be worked from — it is specific, it names the step and the control
index, and it cites the instrument.

## What the app does with this

`src/seed/swms/templates.json` carries a short `review` block per statement,
generated from these files. `mergeSwms` collects the uncleared ones onto
`MergedSwms.notCleared`, `validateSwms` raises a blocking issue for each, and
the record screen shows them. **A statement nobody has cleared cannot be
signed.** A missing `review` block counts as not cleared — silence is not a
clearance.

There are three states, not two, because they are three different things to be
holding at a hatch:

| State | `cleared` | `findings` | `correctedAgainst` |
| --- | --- | --- | --- |
| Nobody has read it | false | empty | absent |
| A reviewer refused it | false | what is unanswered | absent |
| Corrected, waiting on a cold read | false | empty | the count and a note |

All ten are currently in the third state. The banner says so in those terms
rather than listing findings the document no longer has — a crew that learns
the banner is stale stops reading it, and that costs the next one that is true.
`swmsReview.test.ts` holds the three states apart and refuses to let a
correction round clear its own work.

The statements are still worth reading and briefing a crew from; they are
substantially right and far better than the nothing that came before. They are
not worth signing, because a signature says the document describes how the work
will actually be done.

## Outstanding

1. ~~Correct each statement against the `fix` field of every finding filed
   against it — fatal, serious and minor.~~ Done: all 87 findings across all
   ten statements.
2. **Have each corrected statement read cold by a reviewer who has not seen the
   correction, and file that read here in place of this one.** This is the only
   thing standing between these statements and a signature, and it cannot be
   done by whoever made the correction.
3. Set `review.cleared` to `true` only where that reviewer would sign the
   corrected statement, and the signature gate opens on its own.

`src/__tests__/swmsReview.test.ts` holds the seed and these files together, so a
statement cannot be marked cleared while a filed review here refuses it.

Rounds have not converged quickly and that is worth knowing before promising a
date. Each read has been deeper than the last rather than a re-run of it, so the
next one should be expected to find things this correction did not reach — that
is what the read is for, and it is why the gate is where it is.
