import { createContext, useContext } from "react";
import { useStatusStream as useStatusStreamHook } from "./useStatusStream";

type StatusStreamReturn = ReturnType<typeof useStatusStreamHook>;

const StatusStreamContext = createContext<StatusStreamReturn | null>(null);

export function StatusStreamProvider({ children }: { children: React.ReactNode }) {
  const value = useStatusStreamHook();
  return (
    <StatusStreamContext.Provider value={value}>
      {children}
    </StatusStreamContext.Provider>
  );
}

export function useStatusStream(): StatusStreamReturn {
  const ctx = useContext(StatusStreamContext);
  if (!ctx) {
    throw new Error("useStatusStream must be used within a StatusStreamProvider");
  }
  return ctx;
}
