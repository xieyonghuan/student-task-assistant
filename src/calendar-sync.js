import { dueTimestamp } from './domain.js';
import { isNativeApp, nativeCall } from './native.js';

let tail = Promise.resolve();
export function calendarSnapshot(tasks) {
  return tasks.filter(task => task.dueDate).map(task => ({
    id: task.id, title: task.title, details: task.details || '',
    begin: dueTimestamp(task), completed: !!task.completedAt, dateOnly: !task.dueTime,
  }));
}
export async function calendarStatus() {
  return isNativeApp() ? nativeCall('calendarStatus') : { available: false, enabled: false, granted: false };
}
export async function setCalendarEnabled(enabled) {
  return nativeCall(enabled ? 'calendarEnable' : 'calendarDisable');
}
// Serialize snapshots: an older save can never overwrite a newer one.
export function syncCalendar(tasks) {
  if (!isNativeApp()) return Promise.resolve({ enabled: false });
  const snapshot = calendarSnapshot(tasks);
  const run = tail.catch(() => {}).then(() => nativeCall('calendarSync', { tasks: snapshot }));
  tail = run;
  return run;
}
