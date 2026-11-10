import { useSyncExternalStore } from "react";
import {
  getInstallSnapshot,
  install,
  subscribeInstall,
  type InstallResult,
} from "./installStore";

export type { InstallResult };

export interface InstallPrompt {
  canInstall: boolean;
  install: () => Promise<InstallResult>;
  installed: boolean;
}

export function useInstallPrompt(): InstallPrompt {
  const { canInstall, installed } = useSyncExternalStore(
    subscribeInstall,
    getInstallSnapshot,
    getInstallSnapshot,
  );
  return { canInstall, install, installed };
}
