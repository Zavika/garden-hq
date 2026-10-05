import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { StorageProvider } from "../state/StorageProvider";
import { createQueryClient } from "../state/queryClient";
import { createGardenStorage, type GardenStorage } from "../state/storage";

export function renderWithProviders(
  ui: ReactElement,
  options: { storage?: GardenStorage; route?: string } = {},
) {
  const storage = options.storage ?? createGardenStorage(null);
  const client = createQueryClient();
  const result = render(
    <QueryClientProvider client={client}>
      <StorageProvider storage={storage}>
        <MemoryRouter initialEntries={[options.route ?? "/"]}>
          {ui}
        </MemoryRouter>
      </StorageProvider>
    </QueryClientProvider>,
  );
  return { ...result, storage, client };
}
