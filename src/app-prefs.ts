import AsyncStorage from '@react-native-async-storage/async-storage';

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
  simproDomain: 'safeqld.simprosuite.com',
  simproCompanyId: '',
  simproClientId: '',
  simproProxyUrl: '',
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
