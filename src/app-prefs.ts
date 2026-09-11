import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_SHORTCUTS, migrateShortcuts } from '@/domain/modules';
import { company } from '@/theme/brand';

/**
 * Technician preferences.
 *
 * Held here rather than in the Settings route so any screen can read them
 * without importing a tab screen.
 */

const PREFS_KEY = 'safeqld.prefs';

export interface Prefs {
  /**
   * Which half of the app this device shows.
   *
   * Held as a plain string rather than the AppMode union so an older build
   * reading a value a newer one wrote does not fail to parse its whole
   * settings blob over one field. `readMode` in @/domain/appMode turns it into
   * a mode and says when it did not recognise what it found.
   */
  appMode: string;
  technicianName: string;
  /**
   * Which Simpro employee this phone belongs to, and their address there.
   *
   * Simpro's own id rather than a name, because the id is what a schedule
   * block carries and what survives a rename. Blank until somebody picks
   * themselves from the synced staff list or signs in with their Simpro
   * login. The display name above is seeded from it only where it was blank
   * and stays the technician's to edit — it is what goes on a report.
   */
  simproEmployeeId: string;
  simproEmployeeEmail: string;
  technicianLicence: string;
  vehicleRego: string;
  companyName: string;
  simproDomain: string;
  simproCompanyId: string;
  simproClientId: string;
  /**
   * The client ID of a second API application, the one that signs a person in.
   *
   * An API application in Simpro has one Authentication Method, fixed when it
   * is created. The office's is Client Credentials — how a phone reaches
   * Simpro with nobody logged in — and that kind refuses every login. Signing
   * in as yourself needs an application made with a method that allows it,
   * which is a different application with a different id and secret. Empty
   * until the office makes one, and then the staff list is the way in.
   */
  simproSignInClientId: string;
  simproProxyUrl: string;
  /**
   * Whether a completed test is written back onto the asset in Simpro.
   *
   * Off until someone turns it on, and deliberately so. Every other outbound
   * kind appends — a note, an order — and the worst a bad one does is add
   * something to delete. This one edits a record the office schedules from,
   * across 12,546 live assets, and the endpoint it uses could not be verified
   * without writing to that live register. Prove it on one asset first.
   */
  simproWriteAssetTests: boolean;
  /**
   * Whether defect photographs go onto the Simpro job as attachments.
   *
   * On by default, unlike the asset-test switch above: an attachment is
   * appended, never overwrites anything, and a photograph beside the note
   * that describes the fault is what the office asked for. Off keeps them on
   * the phone and in the report, and the notes say so.
   */
  simproSendPhotos: boolean;
  /**
   * Whether a job's record may be sent to the language model for a brief.
   *
   * Off until someone turns it on, and separate from having a key at all.
   * The grounded search and the defect wording send nothing about a site by
   * construction; the job brief cannot work without the office's description
   * and notes, which name the customer. That is a different thing to agree
   * to, so it is a different switch, and the note beside it in Settings says
   * exactly what leaves the phone. Checked in src/ai/jobBrief.ts, not only
   * on the screen.
   */
  aiShareJobRecords: boolean;
  /**
   * Whether the office copy is kept current without anybody pressing anything.
   *
   * On by default, because "I'm sick of syncing" was the whole brief: changes
   * come down every half hour and everything once a day, and queued work goes
   * up the moment there is signal. Sync now in Settings works either way.
   */
  autoSync: boolean;
  /**
   * The technician's own home screen, as a list of routes.
   *
   * Routes rather than labels, because a route is the stable identity — a
   * screen gets renamed far more often than it gets moved.
   */
  shortcuts: string[];
  /**
   * Where a request for information and a leave request go.
   *
   * Starts as the company's service inbox rather than blank, because a blank
   * default would leave the Ask the office button dead on every phone until
   * somebody typed an address into each one. The office changes it once here
   * if a supervisor would rather have it direct.
   */
  supervisorEmail: string;
  /** Where a suggestion about the app itself goes. Same reasoning. */
  suggestionsEmail: string;
  /**
   * Charge-out rates, in whole cents excluding GST.
   *
   * Held here rather than shipped in the repository: these are commercial terms
   * including cost, and therefore margin. Zero means not set, and the app says
   * so rather than quoting at nothing.
   */
  normalHoursSellCents: number;
  afterHoursSellCents: number;
  attendanceNormalCents: number;
  attendanceNormalMinutes: number;
  attendanceAfterHoursCents: number;
  attendanceAfterHoursMinutes: number;
  /**
   * Light, dark, or whatever the phone is set to.
   *
   * The app is built dark-first — the rooms it is used in are switch rooms,
   * risers and carparks — and followed the operating system, which on a phone
   * that switches to light at sunrise means the app goes light at exactly the
   * hour a technician walks into the first plant room of the day. Locking it
   * is one setting, and 'system' stays the default because most people never
   * think about this and the operating system is a reasonable guess.
   */
  theme: 'system' | 'dark' | 'light';
}

export const DEFAULT_PREFS: Prefs = {
  // Technician, because most installs are a phone in a van and a mode switch
  // that starts by showing everything would only ever be found by the people
  // who did not need it.
  appMode: 'technician',
  technicianName: '',
  simproEmployeeId: '',
  simproEmployeeEmail: '',
  technicianLicence: '',
  vehicleRego: '',
  companyName: 'Safe QLD Pty Ltd',
  // Everything about the Safe QLD build except the secret, so setting the app
  // up is one paste and one tap rather than four fields typed off a phone.
  //
  // These three are identifiers, not credentials: the client ID authenticates
  // nothing on its own, and the company ID is 0 on this build — which is why it
  // is a string. Left as a number it would be falsy, and every "is this
  // configured yet" check in the app would read a correctly configured install
  // as blank.
  //
  // The client secret is deliberately absent. Anything committed here is bundled
  // into the APK and ships to every phone, so a secret placed here would be
  // readable by anyone holding the file. It is pasted once into the platform
  // keystore instead, or removed from devices entirely by setting `simproProxyUrl`.
  simproDomain: 'safeqld.simprosuite.com',
  simproCompanyId: '0',
  simproClientId: '6564738df3bba3cd587e3dacb58a1d',
  simproSignInClientId: '',
  simproProxyUrl: '',
  simproWriteAssetTests: false,
  simproSendPhotos: true,
  aiShareJobRecords: false,
  autoSync: true,
  shortcuts: DEFAULT_SHORTCUTS,
  supervisorEmail: company.email,
  suggestionsEmail: company.email,
  normalHoursSellCents: 0,
  afterHoursSellCents: 0,
  attendanceNormalCents: 0,
  attendanceNormalMinutes: 120,
  attendanceAfterHoursCents: 0,
  attendanceAfterHoursMinutes: 180,
  theme: 'system',
};

export async function loadPrefs(): Promise<Prefs> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const saved = JSON.parse(raw) as Partial<Prefs>;
    // A home screen nobody chose gets the current defaults; one somebody
    // edited is theirs and stays. See migrateShortcuts.
    return { ...DEFAULT_PREFS, ...saved, shortcuts: migrateShortcuts(saved.shortcuts) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function savePrefs(prefs: Prefs): Promise<void> {
  await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

/**
 * Change some settings without writing back the ones you were not changing.
 *
 * Every screen that edits preferences used to hold the whole blob in state
 * from the moment it loaded and write all of it back on each change. Two
 * screens doing that is a clobber waiting to happen, and the theme lock made
 * it happen: it is set from Settings, persisted on its own, and the very next
 * edit on that same screen — a name, a rate, anything — wrote the blob it had
 * read before the lock and quietly put the theme back to following the phone.
 * The home screen's tile order has the same shape and the same hazard in the
 * other direction.
 *
 * So a change is a change. The patch is merged onto what is actually on disk
 * at the moment of writing, rather than onto a snapshot that may be an hour
 * old.
 */
export async function patchPrefs(patch: Partial<Prefs>): Promise<Prefs> {
  const onDisk = await loadPrefs();
  const next = { ...onDisk, ...patch };
  await savePrefs(next);
  return next;
}
