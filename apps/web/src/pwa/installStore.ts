interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallResult = "accepted" | "dismissed" | "unavailable";

export interface InstallSnapshot {
  canInstall: boolean;
  installed: boolean;
}

let stashed: BeforeInstallPromptEvent | null = null;
let snapshot: InstallSnapshot = { canInstall: false, installed: false };
let listening = false;
const listeners = new Set<() => void>();

function update(next: InstallSnapshot): void {
  if (
    next.canInstall === snapshot.canInstall &&
    next.installed === snapshot.installed
  ) {
    return;
  }
  snapshot = next;
  listeners.forEach((fn) => fn());
}

function onPrompt(e: Event): void {
  e.preventDefault();
  stashed = e as BeforeInstallPromptEvent;
  update({ ...snapshot, canInstall: true });
}

function onInstalled(): void {
  stashed = null;
  update({ canInstall: false, installed: true });
}

/** Call once at startup: the browser fires beforeinstallprompt only once. */
export function startInstallCapture(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);
}

export function subscribeInstall(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getInstallSnapshot(): InstallSnapshot {
  return snapshot;
}

export async function install(): Promise<InstallResult> {
  const event = stashed;
  if (event === null) return "unavailable";
  stashed = null;
  update({ ...snapshot, canInstall: false });
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome;
}
