/**
 * The app's entry point.
 *
 * Normally this would be `expo-router/entry` straight from package.json. It is
 * a file of our own for one reason: the background sync task has to be
 * defined at bundle scope before the operating system calls it, and
 * expo-router loads route files lazily — on a cold background launch there is
 * no screen to mount, so the root layout, and the task definition it imports,
 * may never run. expo-task-manager then reports the task as not defined and
 * drops its registration. Importing the definition here, ahead of the router,
 * means it is evaluated on every launch of the JavaScript, screen or not.
 */
import './src/simpro/autoSyncTask';
import 'expo-router/entry';
