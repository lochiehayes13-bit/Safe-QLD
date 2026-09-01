# Running Safe QLD

Three ways to get the app in your hand, fastest first.

## 1. Expo Go — fastest, no build, ~5 minutes

Every native module this app uses (SQLite, file system, camera, print, location,
secure store) ships inside the Expo Go runtime for SDK 57, so it runs without a
custom build.

On the computer, in the project folder:

```bash
npm install
npm start
```

Metro prints a QR code. On the phone:

1. Install **Expo Go** from the Play Store.
2. Open it and scan the QR code.

The phone and the computer must be on the same Wi-Fi. If the phone cannot reach
the computer — a guest network, or a work network with client isolation — run
it through Expo's relay instead:

```bash
npx expo start --tunnel
```

Slower to load, but works from anywhere.

**What works in Expo Go:** everything except installing the app as its own icon.
The database, the imports, the reports, the camera and the PDF generation all
run for real. Data is stored inside Expo Go's sandbox, so it is cleared if you
uninstall Expo Go.

## 2. A real APK — the app on the phone, no computer needed

This builds in Expo's cloud and gives you a link to install from. You need a
free Expo account.

```bash
npx eas login          # first time only
npm run build:apk
```

It prints a build URL. When it finishes (usually 10–20 minutes) the page has a
QR code and an install link. Open it on the phone, allow installing from an
unknown source, and it installs like any other app.

This is the one to hand to a technician. It keeps its own data, has its own
icon, and does not need Expo Go.

## 3. Play Store internal testing

When you want several technicians on it with automatic updates:

```bash
npm run build:play     # produces an .aab for the Play Console
```

Upload the `.aab` to the Play Console under **Internal testing** and add
testers by email. Requires a Google Play developer account.

---

## Checking it before you build

```bash
npm run check          # typecheck + the full test suite
npm run bundle:android # proves every route and import resolves
```

`npm run check` is the one that catches real breakage. The bundle command is
what tells you the app will actually start — a typo in a route reads as a dead
button rather than an error, and this catches it.

## Where the data goes

Nothing leaves the device unless you deliberately sync or share. Sites, assets,
defects, reports and photographs live in a SQLite database inside the app's own
storage. The Simpro client secret, if you use one, is held in the platform
keystore rather than ordinary app storage.

## If something goes wrong

**Metro will not start** — delete `node_modules` and `npm install` again. Expo
pins native module versions to the SDK, and a mismatched one usually shows up
here first.

**The app opens to a blank screen** — check the Metro terminal. A failed import
prints there, not on the phone.

**A screen is a dead button** — that is a route that does not resolve. Run
`npm run bundle:android`; the test suite also checks every navigation target
against the files actually present.
