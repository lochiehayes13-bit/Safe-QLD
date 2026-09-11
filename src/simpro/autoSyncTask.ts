import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { runAutoSync } from './autoSync';

/**
 * The sync that runs while the app is not open.
 *
 * Importing this module is what defines the task: TaskManager.defineTask has
 * to run at bundle scope, not inside a component, because a background
 * launch spins up the JavaScript with no screen to mount. That is why the
 * app's entry file (index.js) imports this before it imports the router —
 * expo-router loads route files lazily, so a definition that lived only
 * under the root layout would not exist on a cold background launch, and
 * the system would drop the registration. AutoSyncDriver imports it too,
 * which is harmless and keeps the dependency visible.
 */
export const AUTO_SYNC_TASK = 'safeqld.autosync';

/**
 * In minutes, which is the unit expo-background-task takes.
 *
 * Fifteen is the floor the API allows, and it is a floor rather than a
 * schedule: the operating system decides when, and on iOS often waits for the
 * phone to be idle and charging. The policy decides whether anything is
 * actually due when it fires, so asking often costs nothing but a check.
 */
export const AUTO_SYNC_MINIMUM_INTERVAL_MINUTES = 15;

TaskManager.defineTask(AUTO_SYNC_TASK, async () => {
  // Never throws, so the only outcome to report is that the check ran.
  await runAutoSync('background');
  return BackgroundTask.BackgroundTaskResult.Success;
});

/**
 * Asks the system to run the task. Returns why it could not, or null.
 *
 * Quiet about a task that is already registered — the library returns early
 * on that itself — and about a build where the API is missing, such as Expo
 * Go on Android, so the driver can call this on every launch to repair a
 * registration the system dropped.
 */
export async function registerAutoSyncTask(): Promise<string | null> {
  try {
    if (!(await TaskManager.isAvailableAsync())) {
      return 'Background sync is not available on this build.';
    }
    if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) {
      return 'The system is not allowing this app to work in the background.';
    }
    await BackgroundTask.registerTaskAsync(AUTO_SYNC_TASK, {
      minimumInterval: AUTO_SYNC_MINIMUM_INTERVAL_MINUTES,
    });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export async function unregisterAutoSyncTask(): Promise<void> {
  try {
    if (!(await TaskManager.isAvailableAsync())) return;
    // Returns quietly when nothing is registered.
    await BackgroundTask.unregisterTaskAsync(AUTO_SYNC_TASK);
  } catch {
    // A task that cannot be unregistered is one that was never registered.
  }
}
