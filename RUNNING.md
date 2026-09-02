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

(The repository carries an `.npmrc` setting `legacy-peer-deps=true`. Expo 57's
own dependency tree has a peer conflict npm will not resolve on its own, and
without that setting `npm install` fails on a clean checkout.)

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

### Building the same APK on your own machine, without an Expo account

EAS is easier, but it needs an account and it needs signal. This route needs
neither, and it is the same app.

You need a JDK (17 or newer) and the Android SDK. If you have Android Studio
they are already there; otherwise the command line tools alone are enough:

```bash
# once: SDK in ~/android-sdk, about 3 GB
export ANDROID_HOME="$HOME/android-sdk"
mkdir -p "$ANDROID_HOME/cmdline-tools"
curl -L -o /tmp/cmdline-tools.zip \
  https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
unzip -q /tmp/cmdline-tools.zip -d "$ANDROID_HOME/cmdline-tools"
mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" \
  "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006"
```

Then, from the repository:

```bash
npx expo prebuild --platform android   # writes ./android, safe to delete after
cd android && ./gradlew assembleRelease
```

The APK lands at `android/app/build/outputs/apk/release/app-release.apk`.
Copy it to the phone and open it; Android asks once for permission to install
from that source.

The first build takes a while — Gradle fetches its own distribution and every
dependency — and later ones are minutes.

Two things worth knowing. The `android/` directory is generated, is not in
version control, and can be deleted and regenerated at any time; edit
`app.json` rather than anything inside it. And this APK is signed with the
standard Android debug key, which is fine for sideloading onto your own
handsets and is **not** accepted by the Play Store — route 3 below is the one
for that.

## 3. Play Store internal testing

When you want several technicians on it with automatic updates:

```bash
npm run build:play     # produces an .aab for the Play Console
```

Upload the `.aab` to the Play Console under **Internal testing** and add
testers by email. Requires a Google Play developer account.

---

## First run — one name, one paste

A fresh install opens on the **home hub**: the question bar over everything the
app holds, a grid of modules the technician arranges themselves, and the rest
of the app one tap down under **Everything**. It carries nothing about anyone's
jobs unless they pin the Jobs module, because the app does not know who is
holding the phone and the projects crew, the apprentices and the office all
use it.

Two things make it theirs:

1. **Settings → You → Name.** Timesheets, questions to the office, leave
   requests and suggestions all go out under it. Home reminds you until it is
   set.
2. **Settings → Simpro → paste the client secret.** Everything else about the
   Safe QLD build is already filled in. From then on the office data comes down
   on its own — a partial pull every half hour while the app is open, a full
   pull once a day, and a background pull when it is closed — and anything the
   phone queues for the office goes up the moment there is signal. **Sync now**
   is still there for when you want a full pull immediately.

**Who you are.** Settings → **You in Simpro** → *Pick who I am* lists the
office's staff (it comes down with the sync); tapping your name seeds the name
on reports and tells **My day** whose schedule to show. **Sign in with Simpro**
is the same login as Simpro Mobile: after that, notes you write from the app
are yours in Simpro. The browser sign-in needs the Redirect URI on the API
application in Simpro's setup to be exactly `safeqld://oauth`.

**Newer builds.** Every build knows which commit it is (Settings → About).
When a newer APK has been published, a card appears on the home screen with a
download button. The download page is on a private repository, so until the
releases are mirrored to a public one (see the last step in
`.github/workflows/ci.yml`), that button lands on a GitHub login page.

**Arrange** on the home screen moves tiles earlier or later and takes them off;
**Add a module** opens the full list by group, where every module can be opened
or pinned. Each phone keeps its own layout.

**Suggest a change** on the home screen emails an idea, a fault or missing
information under the subject tag `[Safe QLD app]` to the suggestions address
in Settings (the company service inbox by default). Those emails are the
backlog: a change made from one lands in a later build at the same download
link. The app cannot rewrite itself on the phone, and should not — a change
nobody has read is how a fire app ends up wrong.

The app opens in **technician mode**, which keeps the office half — planning,
quoting, ordering, portfolio — out of the lists. Nothing is deleted: Settings →
**What this device shows** switches to office mode, and every hidden screen
says why it is hidden and how it is still reached.

Nothing else needs setting up. Every calculator, the standards library and the
whole reference work offline with no account and no key.

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
