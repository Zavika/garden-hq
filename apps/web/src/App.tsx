import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ContestsScreen } from "./screens/ContestsScreen";
import { GreenhouseScreen } from "./screens/GreenhouseScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { LinkScreen } from "./screens/LinkScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { StorageProvider } from "./state/StorageProvider";
import { createQueryClient } from "./state/queryClient";

export default function App() {
  const [client] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      <StorageProvider>
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
      </StorageProvider>
    </QueryClientProvider>
  );
}
