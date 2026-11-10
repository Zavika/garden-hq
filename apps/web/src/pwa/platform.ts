export interface PlatformEnv {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  standaloneNav?: boolean;
  displayModeStandalone: boolean;
}

export const IOS_PUSH_NOTE =
  "On iPhone and iPad, web push alerts only work after you add Garden HQ to the Home Screen (iOS 16.4 or later).";

const NOT_SAFARI = /CriOS|FxiOS|EdgiOS|OPiOS/;

export function readPlatformEnv(): PlatformEnv {
  if (typeof navigator === "undefined") {
    return {
      userAgent: "",
      platform: "",
      maxTouchPoints: 0,
      displayModeStandalone: false,
    };
  }
  const nav = navigator as Navigator & { standalone?: boolean };
  const displayModeStandalone =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;
  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints,
    standaloneNav: nav.standalone,
    displayModeStandalone,
  };
}

export function isIos(env: PlatformEnv = readPlatformEnv()): boolean {
  if (/iPhone|iPad|iPod/.test(env.userAgent)) return true;
  // iPadOS 13+ reports as a Mac but has a touch screen.
  return env.platform === "MacIntel" && env.maxTouchPoints > 1;
}

export function isIosSafari(env: PlatformEnv = readPlatformEnv()): boolean {
  return isIos(env) && !NOT_SAFARI.test(env.userAgent);
}

export function isStandalone(env: PlatformEnv = readPlatformEnv()): boolean {
  return env.displayModeStandalone || env.standaloneNav === true;
}
