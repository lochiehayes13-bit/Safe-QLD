import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_SHORTCUTS } from '@/domain/modules';

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
  technicianLicence: string;
  vehicleRego: string;
  companyName: string;
  simproDomain: string;
  simproCompanyId: string;
  simproClientId: string;
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
   * The technician's own home screen, as a list of routes.
   *
   * Routes rather than labels, because a route is the stable identity — a
   * screen gets renamed far more often than it gets moved.
   */
  shortcuts: string[];
  /** Where a request for information goes. Set per company, not per phone. */
  supervisorEmail: string;
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
}

export const DEFAULT_PREFS: Prefs = {
  // Technician, because most installs are a phone in a van and a mode switch
  // that starts by showing everything would only ever be found by the people
  // who did not need it.
  appMode: 'technician',
  technicianName: '',
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
  simproProxyUrl: '',
  simproWriteAssetTests: false,
  shortcuts: DEFAULT_SHORTCUTS,
  supervisorEmail: '',
  normalHoursSellCents: 0,
  afterHoursSellCents: 0,
  attendanceNormalCents: 0,
  attendanceNormalMinutes: 120,
  attendanceAfterHoursCents: 0,
  attendanceAfterHoursMinutes: 180,
};

export async function loadPrefs(): Promise<Prefs> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function savePrefs(prefs: Prefs): Promise<void> {
  await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}
