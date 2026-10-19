import { createContext, useContext, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { SyncEngine, SyncSnapshot } from "./sync";

const SyncContext = createContext<SyncEngine | null>(null);

export function SyncProvider({
  engine,
  children,
}: {
  engine: SyncEngine;
  children: ReactNode;
}) {
  return <SyncContext.Provider value={engine}>{children}</SyncContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSyncEngine(): SyncEngine {
  const engine = useContext(SyncContext);
  if (engine === null) throw new Error("useSyncEngine outside SyncProvider");
  return engine;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSyncSnapshot(): SyncSnapshot {
  const engine = useSyncEngine();
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot);
}
