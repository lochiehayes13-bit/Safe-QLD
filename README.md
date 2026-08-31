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

**Parts.** 707 part numbers with electrical specifications, harvested from
suppliers' own public catalogues and datasheets.

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
  parsers/      CSV, column mapping, device-type normalisation
  seed/         asset types, defect library, service routines, catalogue
  share/        .sqld pack format
  simpro/       API client and resource mappers
```

The XLSX writer is hand-rolled over a minimal ZIP implementation rather than
using SheetJS, which misbehaves under React Native's Node shims and carries
known advisories. Generated workbooks are verified to open in a real
spreadsheet reader.

## Testing

238 tests, run without a native toolchain:

```bash
npm test
```

They cover the calculators against published worked examples and manufacturer
address charts, the XLSX and ZIP writers, the share pack round-trip, timesheet
arithmetic, and baseline autofill.
