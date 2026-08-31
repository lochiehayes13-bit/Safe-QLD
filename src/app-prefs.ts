import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Technician preferences.
 *
 * Held here rather than in the Settings route so any screen can read them
 * without importing a tab screen.
 */

const PREFS_KEY = 'safeqld.prefs';

export interface Prefs {
  technicianName: string;
  technicianLicence: string;
  vehicleRego: string;
  companyName: string;
  simproDomain: string;
  simproCompanyId: string;
  simproClientId: string;
  simproProxyUrl: string;
}

export const DEFAULT_PREFS: Prefs = {
  technicianName: '',
  technicianLicence: '',
  vehicleRego: '',
  companyName: 'Safe QLD Pty Ltd',
  simproDomain: 'safeqld.simprosuite.com',
  simproCompanyId: '',
  simproClientId: '',
  simproProxyUrl: '',
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
