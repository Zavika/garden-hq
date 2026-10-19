import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { api } from "./api/client";
import { Layout } from "./components/Layout";
import { ContestsScreen } from "./screens/ContestsScreen";
import { GreenhouseScreen } from "./screens/GreenhouseScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { LinkScreen } from "./screens/LinkScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { StorageProvider } from "./state/StorageProvider";
import { SyncProvider } from "./state/SyncProvider";
import { createQueryClient } from "./state/queryClient";
import { browserBacking, createGardenStorage } from "./state/storage";
import { createSyncEngine } from "./state/sync";

export default function App() {
  const [client] = useState(createQueryClient);
  const [engine] = useState(() =>
    createSyncEngine({
      base: createGardenStorage(browserBacking()),
      api,
      backing: browserBacking(),
    }),
  );
  useEffect(() => engine.start(), [engine]);
  return (
    <QueryClientProvider client={client}>
      <StorageProvider storage={engine.storage}>
        <SyncProvider engine={engine}>
          <BrowserRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<HomeScreen />} />
                <Route path="greenhouse" element={<GreenhouseScreen />} />
                <Route path="link" element={<LinkScreen />} />
                <Route path="contests" element={<ContestsScreen />} />
                <Route path="settings" element={<SettingsScreen />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </SyncProvider>
      </StorageProvider>
    </QueryClientProvider>
  );
}
