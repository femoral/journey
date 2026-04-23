import { createContext, useContext } from "solid-js";
import type { ConsoleStore } from "./consoleStore";

export const ConsoleContext = createContext<ConsoleStore | undefined>(undefined);

export function useConsole(): ConsoleStore {
  const ctx = useContext(ConsoleContext);
  if (!ctx) {
    throw new Error(
      "useConsole() called outside ConsoleContext.Provider — wrap routes in <Shell>",
    );
  }
  return ctx;
}
