import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { ApiError, type SyncApi } from "../api/client";
import { SyncProvider } from "../state/SyncProvider";
import { StorageProvider } from "../state/StorageProvider";
import { createQueryClient } from "../state/queryClient";
import { createGardenStorage, type GardenStorage } from "../state/storage";
import { createSyncEngine, type SyncEngine } from "../state/sync";

const offline = () => Promise.reject(new ApiError("network", 0, "offline"));
const offlineApi: SyncApi = {
  createAccount: offline,
  getSync: offline,
  postSync: offline,
  deleteAccount: offline,
};

export function renderWithProviders(
  ui: ReactElement,
  options: { storage?: GardenStorage; route?: string; sync?: SyncEngine } = {},
) {
  const storage = options.storage ?? createGardenStorage(null);
  // Inert by default: wraps `storage` but is never started, so tests behave as
  // if there were no cloud sync.
  const sync =
    options.sync ??
    createSyncEngine({ base: storage, api: offlineApi, backing: null });
  const client = createQueryClient();
  const result = render(
    <QueryClientProvider client={client}>
      {/* useStorage() returns the storage passed here (the raw one in tests);
          only App.tsx passes `engine.storage`. */}
      <StorageProvider storage={storage}>
        <SyncProvider engine={sync}>
          <MemoryRouter initialEntries={[options.route ?? "/"]}>
            {ui}
          </MemoryRouter>
        </SyncProvider>
      </StorageProvider>
    </QueryClientProvider>,
  );
  return { ...result, storage, sync, client };
}
