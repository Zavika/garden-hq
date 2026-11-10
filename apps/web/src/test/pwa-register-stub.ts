// Vitest-only stand-in for the `virtual:pwa-register` module, which the PWA
// plugin provides in real builds (the plugin is skipped under vitest).
export function registerSW(): (reload?: boolean) => Promise<void> {
  return () => Promise.resolve();
}
