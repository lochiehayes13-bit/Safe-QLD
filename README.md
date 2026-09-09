# Safe QLD

Field application for Safe QLD fire technicians. Android first, with iOS as a
build target rather than a rewrite.

Everything works offline. There is no account and no cloud copy of a job unless
someone deliberately shares or syncs it.

```bash
npm install
npm start              # Expo dev server
npm run check          # typecheck + tests
npm run build:apk      # EAS build, installable APK
```

## What it does

**Sites, panels and points.** Import a device list exported from any panel's
programming tool and search it by device text, zone text or address. Zone text
is carried on every point row, because confirming zone allocation is the most
common reason to open a config on site. Unused points are hidden by default,
matching how panels present themselves, with a toggle for commissioning work.

**Assets.** One engine covers detectors, panels, pumps, extinguishers,
emergency lights, hydrants, sprinklers, fire doors and passive penetrations —
33 types across 14 systems. They differ only in their type definition and
attributes, so a new class of equipment is data rather than code. Every asset
carries a timeline, which is what makes "why does this keep failing?"
answerable: three failures on one detector is a location problem, not three
unrelated faults.

**Testing.** AS 1851 routines are configuration, not hand-built screens. Each
check knows what to do, what counts as a pass, whether it needs a photo or a
measurement, and the defect it raises when it fails. Marking a device is one
tap, because a sheet running to hundreds of rows gets done on paper otherwise.
Running a routine resolves the site's assets by system, answers each check
against each one, writes the result onto the asset's timeline and raises the
coded defect for anything that failed.

**Defects.** A coded library of 87 defects. Pick system, component and defect
and the app supplies the severity, the formal report wording, the plain-English
client wording, the rectification and the quote lines. Free text stays for what
only the person standing in front of it knows.

**Impairments.** Declaring one starts a clock that stays on the home screen
until the system is restored, and closing it out warns about the notifications
and fire watch still outstanding.

**Safe QLD forms.** Baseline data and the weekly timesheet, reproduced field for
field against the company templates — the baseline export lands at exactly the
same dimensions as the supplied original. Baseline data fills its zone table
straight from the imported device list rather than being transcribed 32 rows at
a time.

**Calculators.** Battery sizing to the Australian formula, VESDA sizing, cable
volt drop, Ohm's law and power, unit conversion, resistor decoding, device
addressing, and an end-of-line reference. Each shows its working and cites its
source.

**Parts.** 11,865 part numbers from every supplier Safe QLD buys from, taken from their own
public product APIs and storefronts rather than transcribed from PDFs. Scan a
tag or type a code and the app tries the asset register, then serials, then the
catalogue. Where a distributor does not publish the manufacturer, the row says
so instead of guessing one.

**Queensland statutory work.** A critical defect starts its notice and
rectification clocks and prints a notice to hand over on site. The annual
occupier statement fills itself in from the site's own register and defect
history, lists all 21 prescribed installations including the ones the building
does not have, and tracks the ten working days to copy the Commissioner. Both
say plainly that they are not the regulator's approved form.

**Scheduling.** Every routine run is recorded, and the next one is counted from
the *first* service at that site rather than the last — scheduling from the last
completion lets drift accumulate, so a service done three weeks late becomes the
new baseline and the app reports compliance while sliding out of tolerance. Each
site lists what is due with its tolerance window; the home screen carries an
overdue count across every site.

**Purchase ordering.** A site's open defects become a parts order, built from
the coded quote lines. Labour is excluded — it belongs on the quote, not on an
order a supplier has to fill — and part numbers are never invented, because the
right detector head depends on the panel and the protocol. Submitting queues it
for Simpro rather than sending, so a basement with no signal cannot lose it.

**Things I need.** The parts note that currently lives on a dashboard or in
somebody's phone: what to grab now, and what has to be on hand before work that
has not come around yet. A line needs three words — "flow meter" is a complete
one — and a count, a building and a catalogue part number are read out of the
line or offered underneath it, never required. Ticking a line marks it got and
keeps it, so a tick on the wrong row is one tap to undo. The lines wanted now go
to the office on the existing purchase request, and the whole list exports as a
spreadsheet rather than being read out over the phone.

**Routing.** The day's jobs ordered by proximity, urgent work first regardless
of distance, handing off to the phone's maps app for the actual navigation.
Distances are straight-line and the screen says so.

**Zone charts.** Generated from the configuration imported off that panel, so
the chart cannot disagree with the panel. Zones carrying devices with no zone
text, and devices reporting to a zone that is not in the table, are printed on
the chart in red rather than hidden.

**Sharing.** A site packs to a `.sqld` file carrying only normalised data and
never the vendor's original — a real 1.67 MB configuration packs to 61 KB.

**The office, on the phone.** Everything Simpro holds for a technician is
mirrored onto the device and searched in one box: jobs, sites, customers,
contacts, quotes, invoices, purchase orders, the office catalogue, leads and
suppliers, by the office's own numbers first. A job card changes the status,
adds notes and materials, attaches photos and documents and takes the
customer's signature. The clock goes on against a Simpro job and the hours come
back as schedule blocks. The asset register is created, edited, archived and
deleted from site. The calendar shows the team's week and a person can book
themselves onto a job, move their block or take it off. Every one of those goes
through a queue that survives a basement, and the ones with an undo hold for
half a minute before they go anywhere.

**Coverage.** "Not tested" is recorded as its own result with a reason, never as
a pass. A failure raises a defect and a pass closes the item; an inaccessible
device does neither, which is why it goes unchased. Those are listed per site
until the asset is actually tested.

## Where the numbers come from

The calculators are the part a technician will trust without checking, so each
is a pure module with tests pinned to published worked examples. Three of those
examples are the ones industry guidance uses, so a failure means the app
disagrees with what a technician would get by hand.

Some deliberate choices:

- **Battery standby defaults to 72 hours.** The familiar "24 hours plus 30
  minutes" applies only where the power-supply-failure signal is continuously
  monitored. That is common but not universal, and assuming it undersizes the
  battery roughly threefold.
- **Standby and alarm currents are entered per load and never derived from each
  other.** Door holders are the reason: energised in standby, released in
  alarm, so they dominate one and contribute nothing to the other.
- **VESDA figures are derived from published watts**, not stored as pre-rounded
  milliamps, and unpublished aspirator settings are refused rather than
  interpolated across a curve that is not linear.
- **Volt drop uses copper at 75 °C**, not the 20 °C bench figure, and counts DC
  and single-phase runs twice for the return path.
- **There is no universal end-of-line table**, because one would be wrong on
  most sites. EOL varies by panel, card and configured mode, and several
  Australian panels sense current or voltage bands rather than resistance.

Standards themselves are not reproduced. Routine definitions describe the
structure of a service in our own words and name their source; where the actual
figure or interval must come from the current standard or a manufacturer's
documentation, the check says so rather than guessing.

Every requirement records whether it comes from a standard, a manufacturer,
the QDC, the NCC, legislation or a Safe QLD procedure. The app never blurs them.

## Simpro

The client mirrors the Python toolkit already used for back-office work:
OAuth2 client credentials, tokens refreshed ahead of expiry rather than after a
401, and requests paced below the build's 10/sec limit so a field sync never
costs the office their rate budget.

**Signing in.** The office's own application is shipped in the app, so a new
phone is connected before anybody types anything. A technician then signs in
with their own Simpro account, and what they do is recorded against them. The
sign-in is skippable — the app is useful without it — and Settings says which
credential is in use.

**What comes down.** Jobs with their sections, cost centres, items and
attachments; sites, customers, contacts and the customer asset register; quotes
and invoices with their payments and credit notes; purchase orders with their
lines and the suppliers behind them; the office catalogue and its groups; leads,
activities, schedules and the hours the office already holds. A full pull runs
daily, an incremental every half hour, and both are watermarked per resource so
a resource the build refuses does not stall the rest.

**What goes back.** Test results and defects, work-completed notes, photographs
and documents as attachments, purchase requests as orders, timesheet blocks from
the clock, job status changes, job notes, one-off materials, the customer's
signature, asset creates, edits, archives and deletes, and schedule bookings,
moves and removals. Everything is queued locally first and sent by a single
run that claims each row before it sends it, so a change taken back inside its
undo window is never sent, and a row is never sent twice.

**Money the phone does not hold.** Cost, markup, margin and trade prices are
never requested, stored or shown. Sell prices, invoice totals, balances and
payments are, because they are what a customer has already seen. That line is
enforced by a test over the column sets the client asks for, not by
convention.

**The secret.** A client secret sitting on every technician's phone is a real
risk. It is held in the platform keystore, and Settings says so plainly. The
better arrangement is a Safe QLD server holding the secret with the app talking
to that — set a proxy URL and no secret is stored on the device at all. The
client is shaped for that swap.

## The model, where there is one

Four features can use an Anthropic API key, and none of them is required: with
no key, no signal, or a refusal, each sits on top of something that already
works. The rule they share is that a model may order and word what it was
given and may never add a fact, and each checks the answer on the way back
rather than asking nicely in the prompt.

- **Reading the standards.** The search finds the passages; the model says
  which one answers the question. An answer citing a passage that was not
  supplied is discarded.
- **Writing up a defect.** The coded library gives the wording; the model
  folds in what the technician typed. A number that was not in front of it, or
  a code it was not offered, is refused.
- **Writing up a note to the office.** The rough words in the box become a
  note a scheduler can act on. A number nobody typed — a date, a quantity — is
  refused outright.
- **Reading a phrase in Find anything.** Only where the word lists cannot tell
  which kind of record was meant, and only ever to pick which of the typed
  words to search for. A term that was not typed is dropped.

What leaves the phone is, in each case, the question and its passages, or the
words in the box, or the phrase — never a site, a customer or a register. The
one feature that does send job records, the briefing before you walk in, is
behind its own switch that is off until somebody turns it on.

## Layout

```
app/            screens (expo-router, file-based)
src/
  ai/           the four model features and the checks on their answers
  calc/         battery, VESDA, resistor, dipswitch, EOL, electrical, units
  db/           SQLite schema, migrations, repositories
  domain/       types: sites, panels, points, baseline data, timesheets
  export/       XLSX writer, PDF templates, Safe QLD form layouts
  parsers/      vendor config formats, CSV, column mapping, format probe
  seed/         asset types, defect library, service routines, catalogue
  share/        .sqld pack format
  simpro/       API client and resource mappers
scripts/        catalogue harvesters, one per supplier platform
```

The XLSX writer is hand-rolled over a minimal ZIP implementation rather than
using SheetJS, which misbehaves under React Native's Node shims and carries
known advisories. Generated workbooks are verified to open in a real
spreadsheet reader.

## Testing

4,500 tests, run without a native toolchain:

```bash
npm test
```

They cover the calculators against published worked examples and manufacturer
address charts, the XLSX and ZIP writers, the share pack round-trip, timesheet
arithmetic, baseline autofill, and the Queensland date arithmetic.

The migrations are applied to a real SQLite engine, and every static SQL
statement in the repositories is checked against the schema they build — a
column that does not exist compiles perfectly and throws the first time a
technician saves anything. Every route the app navigates to is checked to exist,
because expo-router resolves those at runtime and a typo reads as a dead button
rather than an error.

They also assert the joins the seed data depends on. A routine check names the
defect it raises and the asset type it applies to as plain strings; nothing at
compile time checks those resolve, and nothing at runtime complains when they
do not — a typo means a failed check silently raises nothing. Those references
are tested, along with the rule that a check may only target an asset type in
its own routine's system, since that is how the runner finds them.

One test is off by default, because it is a measurement rather than an
assertion and a slow machine must not fail somebody's build. It builds a
database at the volumes the owner's phone actually holds — 4,562 jobs, 3,059
sites, 12,568 assets, 2,482 customers, 970 quotes, 2,232 invoices and some
thirty-one thousand routine schedule rows, all invented values — and times
every read each screen makes when it opens:

```bash
SAFEQLD_SCALE=1 npx jest scale --silent=false
```

That is the test that found the screens the owner meant when he said the
modules were broken. The job list was reading all four and a half thousand
rows on every focus and filtering them in JavaScript; so, in their own way,
were the sites tab, the quote list, the defect list, the Work hub's badges,
the home screen's schedule strip and the timesheet's job picker. The numbers
it prints are a development machine's; a handset is several times slower.

The parsers are verified against real vendor site files. Those are live
customer data and are never committed, so the tests that read them skip when
the files are absent — every parser therefore also has fixtures built inside
the test, and for the SQLite reader those are real databases built with Node's
own engine and compared value by value against it.

That split is not ceremony. The real Kentec file never exercises a SQLite
overflow page — its widest row is 893 bytes against a 989-byte threshold — so
an error in the overflow arithmetic would have passed every test that used only
real data, and then quietly corrupted the first large site that came along.

The Vigilant parser is the exception on samples: Tyco publishes the SmartConfig
installers without a login, and they carry 44 real configuration files between
them. Those are the vendor's files rather than ours so they are not committed
either, but they are what the parser was built and checked against — all 86
template files across both installers parse without error.

## Reading panel configurations

Seven vendor formats are read directly, without an export step.

| Format | Panel | What comes across |
| --- | --- | --- |
| `.ffp` | Ampac FireFinder | zones, loops, devices, cause and effect |
| `.nle` | Kentec / Incite Taktis | zones, loops, devices, panel I/O, cause and effect |
| `.pci` | Notifier NFS | zones, ten loops, devices, the equations behind the matrix |
| `.util` | Pertronic F-series | zones, loops, devices, output groups, logic blocks |
| `.mx1` `.f4k` | Vigilant MX1, F4000/MX4428 | zones, cards, circuits, panel points, logic equations |
| `.ncf` | brand unconfirmed | site and zones only |
| `.sqld` | Safe QLD share pack | everything |

Formats differ in how much they give up, and the import says so rather than
quietly importing less than it appears to:

- **Kentec** stores device types as keys into Loop Explorer's own device
  library, and that library does not travel with the site file. Points import
  with an unknown type and the key preserved. Guessing "smoke detector" from a
  key would put an invented device on a service sheet.
- **Notifier** does not record the panel model anywhere in the file.
- **Pertronic** writes a short type mnemonic, and FireUtils captions the same
  mnemonics in its device picker. Both halves are kept, so an unmapped code
  still reads as `MS12 — M210E-CZR` rather than `MS12`. Where the caption is a
  part number rather than a function, the class stays unknown on purpose — a
  wrong default test method is worse than none. A code absent from the
  vocabulary entirely is reported by code and count.
- **`.NCF`** keeps its devices in a `.pcf` that has no readable structure, so
  only the site and zone list come across.
- **Notifier `.accdb`** exports carry a database password, which encrypts the
  whole file — measurably so: the body is statistically indistinguishable from
  random. The import names that and points at the `.pci` export instead, rather
  than leaving someone to fetch the same file twice.
- **Fusion `.sts`** unpacks cleanly — a zlib stream behind a twelve-byte
  header — and contains a device table with no text in it at all. There is
  nothing there to name a device with.
- **Vigilant** files are Windows-1252, not UTF-8; 30 of the 44 configuration
  files the vendor ships publicly fail a strict UTF-8 decode on a curly
  apostrophe. And SmartConfig pre-creates every addressable slot — 999 zones,
  127 responder cards — so a reader that cannot tell a slot from a device
  reports every building as having 999 zones. Only what is named or referenced
  is imported. Any record type the reader does not recognise is reported by
  name and count rather than dropped, because the vendor's own templates carry
  no loop devices, so that table has never been seen here and is not going to
  be guessed at.

An unrecognised file is not simply refused. It is probed: container, encoding,
delimiter, record shapes, repeated vocabulary, and whether the bytes have any
structure left in them at all. That last one matters — it is the difference
between "collect a few more samples and this is readable" and "this is
encrypted, and no number of samples will change that".
