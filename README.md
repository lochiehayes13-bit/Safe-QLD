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
32 types across 14 systems. They differ only in their type definition and
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

**Defects.** A coded library of 76 defects. Pick system, component and defect
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

**Routing.** The day's jobs ordered by proximity, urgent work first regardless
of distance, handing off to the phone's maps app for the actual navigation.
Distances are straight-line and the screen says so.

**Zone charts.** Generated from the configuration imported off that panel, so
the chart cannot disagree with the panel. Zones carrying devices with no zone
text, and devices reporting to a zone that is not in the table, are printed on
the chart in red rather than hidden.

**Sharing.** A site packs to a `.sqld` file carrying only normalised data and
never the vendor's original — a real 1.67 MB configuration packs to 61 KB.

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

A client secret sitting on every technician's phone is a real risk. It is held
in the platform keystore, and Settings says so plainly. The better arrangement
is a Safe QLD server holding the secret with the app talking to that — set a
proxy URL and no secret is stored on the device at all. The client is shaped
for that swap.

## Layout

```
app/            screens (expo-router, file-based)
src/
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

660 tests, run without a native toolchain:

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

The parsers are verified against real vendor site files. Those are live
customer data and are never committed, so the tests that read them skip when
the files are absent — every parser therefore also has fixtures built inside
the test, and for the SQLite reader those are real databases built with Node's
own engine and compared value by value against it.

That split is not ceremony. The real Kentec file never exercises a SQLite
overflow page — its widest row is 893 bytes against a 989-byte threshold — so
an error in the overflow arithmetic would have passed every test that used only
real data, and then quietly corrupted the first large site that came along.

## Reading panel configurations

Six vendor formats are read directly, without an export step.

| Format | Panel | What comes across |
| --- | --- | --- |
| `.ffp` | Ampac FireFinder | zones, loops, devices, cause and effect |
| `.nle` | Kentec / Incite Taktis | zones, loops, devices, panel I/O, cause and effect |
| `.pci` | Notifier NFS | zones, ten loops, devices, the equations behind the matrix |
| `.util` | Pertronic F-series | zones, loops, devices, output groups, logic blocks |
| `.ncf` | brand unconfirmed | site and zones only |
| `.sqld` | Safe QLD share pack | everything |

Formats differ in how much they give up, and the import says so rather than
quietly importing less than it appears to:

- **Kentec** stores device types as keys into Loop Explorer's own device
  library, and that library does not travel with the site file. Points import
  with an unknown type and the key preserved. Guessing "smoke detector" from a
  key would put an invented device on a service sheet.
- **Notifier** does not record the panel model anywhere in the file.
- **Pertronic** names most device types plainly; the ones not in the mapping
  are reported by code and count rather than guessed at.
- **`.NCF`** keeps its devices in a `.pcf` that has no readable structure, so
  only the site and zone list come across.
- **Notifier `.accdb`** exports carry a database password, which encrypts the
  whole file — measurably so: the body is statistically indistinguishable from
  random. The import names that and points at the `.pci` export instead, rather
  than leaving someone to fetch the same file twice.
- **Fusion `.sts`** unpacks cleanly — a zlib stream behind a twelve-byte
  header — and contains a device table with no text in it at all. There is
  nothing there to name a device with.

An unrecognised file is not simply refused. It is probed: container, encoding,
delimiter, record shapes, repeated vocabulary, and whether the bytes have any
structure left in them at all. That last one matters — it is the difference
between "collect a few more samples and this is readable" and "this is
encrypted, and no number of samples will change that".
