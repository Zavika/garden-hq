import {
  IOS_PUSH_NOTE,
  isIos,
  isIosSafari,
  isStandalone,
  readPlatformEnv,
  type PlatformEnv,
} from "../pwa/platform";
import { useInstallPrompt } from "../pwa/useInstallPrompt";

export function InstallSection({ env }: { env?: PlatformEnv }) {
  const { canInstall, install, installed } = useInstallPrompt();
  const platform = env ?? readPlatformEnv();

  let body;
  if (installed || isStandalone(platform)) {
    body = <p>Garden HQ is installed on this device.</p>;
  } else if (canInstall) {
    body = (
      <button type="button" onClick={() => void install()}>
        Install app
      </button>
    );
  } else if (isIosSafari(platform)) {
    body = (
      <>
        <p>Tap the Share button, then Add to Home Screen.</p>
        <p className="muted">{IOS_PUSH_NOTE}</p>
      </>
    );
  } else if (isIos(platform)) {
    body = (
      <>
        <p>Open this page in Safari to add it to the Home Screen.</p>
        <p className="muted">{IOS_PUSH_NOTE}</p>
      </>
    );
  } else {
    body = (
      <p className="muted">
        Use your browser&apos;s Install or Add to Home Screen option.
      </p>
    );
  }

  return (
    <section>
      <h2>Install</h2>
      {body}
    </section>
  );
}
