import { createContext, useContext } from "solid-js";
import type { Environment } from "../api/client";

export type EnvSelection = {
  /** Currently selected environment name. Undefined until envs load. */
  selectedEnv: () => string | undefined;
  /** Pick a new environment; persists to localStorage keyed by projectDir. */
  setSelectedEnv: (name: string) => void;
  /** All environments known to the project. */
  environments: () => Environment[];
  /** Values map of the currently selected environment. Empty if none selected. */
  envValues: () => Record<string, string>;
};

export const EnvContext = createContext<EnvSelection | undefined>(undefined);

/** Optional consumer — returns undefined when no provider is present. */
export function useEnvSelection(): EnvSelection | undefined {
  return useContext(EnvContext);
}
