import { useSyncExternalStore } from "react";
import { applyUpdate, dismissPwa, getPwaState, subscribePwa } from "./register";

export function UpdateToast() {
  const { needRefresh, offlineReady } = useSyncExternalStore(
    subscribePwa,
    getPwaState,
  );
  if (!needRefresh && !offlineReady) return null;
  return (
    <div className="update-toast" role="status">
      <span>
        {needRefresh ? "New version available" : "Ready to work offline"}
      </span>
      {needRefresh ? (
        <>
          <button type="button" onClick={() => void applyUpdate()}>
            Reload
          </button>
          <button type="button" onClick={dismissPwa}>
            Later
          </button>
        </>
      ) : (
        <button type="button" onClick={dismissPwa}>
          Dismiss
        </button>
      )}
    </div>
  );
}
