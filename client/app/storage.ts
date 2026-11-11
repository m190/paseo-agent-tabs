import { NativeModules, TurboModuleRegistry } from "react-native";
import type { AppLayoutState } from "../../shared/app-view";

// The native app saves its workspace layout store to AsyncStorage on every change. Plugin code there cannot
// load app modules, but it can call the AsyncStorage native module directly and read the saved copy.

const SAVED_LAYOUT_KEY = "workspace-layout-state";
const READ_TIMEOUT_MS = 500;

interface AsyncStorageModule {
  multiGet(keys: string[], callback: (errors: unknown, result?: [string, string | null][]) => void): void;
}

function asyncStorage(): AsyncStorageModule | null {
  let module: unknown = null;
  try {
    module = TurboModuleRegistry.get("RNCAsyncStorage");
  } catch {
    // Use the legacy module below.
  }
  module ??= (NativeModules as Record<string, unknown>).RNCAsyncStorage;
  return typeof (module as Partial<AsyncStorageModule> | null)?.multiGet === "function" ? (module as AsyncStorageModule) : null;
}

/** The app's saved layout. Null when it is not there, or the storage does not answer in time. */
export function readSavedLayout(): Promise<AppLayoutState | null> {
  const storage = asyncStorage();
  if (!storage) return Promise.resolve(null);
  return new Promise((resolve) => {
    setTimeout(() => resolve(null), READ_TIMEOUT_MS);
    try {
      storage.multiGet([SAVED_LAYOUT_KEY], (errors, result) => {
        const text = errors ? null : (result?.[0]?.[1] ?? null);
        try {
          resolve(text ? ((JSON.parse(text) as { state?: AppLayoutState }).state ?? null) : null);
        } catch {
          resolve(null);
        }
      });
    } catch {
      resolve(null);
    }
  });
}
