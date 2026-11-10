import { registerSW } from "virtual:pwa-register";

export interface PwaState {
  needRefresh: boolean;
  offlineReady: boolean;
}

let state: PwaState = { needRefresh: false, offlineReady: false };
const listeners = new Set<(s: PwaState) => void>();
let updateSW: ((reload?: boolean) => Promise<void>) | undefined;

function setState(next: PwaState): void {
  state = next;
  listeners.forEach((fn) => fn(state));
}

export function getPwaState(): PwaState {
  return state;
}

export function subscribePwa(fn: (s: PwaState) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function registerPwa(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  updateSW = registerSW({
    onNeedRefresh: () => setState({ ...state, needRefresh: true }),
    onOfflineReady: () => setState({ ...state, offlineReady: true }),
  });
}

export async function applyUpdate(): Promise<void> {
  await updateSW?.(true);
}

export function dismissPwa(): void {
  setState({ needRefresh: false, offlineReady: false });
}
