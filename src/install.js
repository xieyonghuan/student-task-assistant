let promptEvent;
let installed = globalThis.matchMedia?.('(display-mode: standalone)').matches || globalThis.navigator?.standalone === true;
const listeners = new Set();
const notify = () => listeners.forEach(listener => listener());

window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); promptEvent = event; notify(); });
window.addEventListener('appinstalled', () => { installed = true; promptEvent = null; notify(); });
export const installState = () => ({ installed, available: !!promptEvent });
export const onInstallChange = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export async function installApp() {
  if (installed) return 'installed';
  if (!promptEvent) return 'manual';
  const event = promptEvent; promptEvent = null;
  await event.prompt();
  const choice = await event.userChoice;
  notify();
  return choice.outcome;
}
