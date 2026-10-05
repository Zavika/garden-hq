import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import {
  browserBacking,
  createGardenStorage,
  type GardenStorage,
  type StoredData,
} from "./storage";

const StorageContext = createContext<GardenStorage | null>(null);

export function StorageProvider({
  storage,
  children,
}: {
  storage?: GardenStorage;
  children: ReactNode;
}) {
  const value = useMemo(
    () => storage ?? createGardenStorage(browserBacking()),
    [storage],
  );
  return (
    <StorageContext.Provider value={value}>{children}</StorageContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useStorage(): GardenStorage {
  const storage = useContext(StorageContext);
  if (storage === null) throw new Error("useStorage outside StorageProvider");
  return storage;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useStoredData(): StoredData {
  const storage = useStorage();
  return useSyncExternalStore(storage.subscribe, storage.getSnapshot);
}
