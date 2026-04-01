import React from "react";
import type { InstanceDetailData } from "../lib/api";

export interface InstanceContextValue {
  detail: InstanceDetailData | null;
  name: string;
  id: string;
  isRunning: boolean;
}

export const InstanceContext = React.createContext<InstanceContextValue | null>(null);
