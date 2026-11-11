import { AppState, Platform } from "react-native";
import { type AppLayoutState, type AppView, layoutView, shownFromPath } from "../../shared/app-view";
import { appModule } from "./bundle";
import { shownWorkspace } from "./route";
import { readSavedLayout } from "./storage";

// This plugin typechecks without the DOM library. Declare only what this module uses.
declare const window: {
  location: { pathname: string };
  addEventListener(type: "popstate", listener: () => void): void;
  removeEventListener(type: "popstate", listener: () => void): void;
};

// What the app shows (see shared/app-view.ts), on each platform:
// - web and desktop: the app's live layout store (from the app bundle) and the URL;
// - native app: the saved copy of the store and the app's route (from the React tree).
// When the plugin cannot read the app (another app build), the view has no selected tabs (web), or the
// watch stays silent (native).

const WEB_WATCH_MS = 500;
const NATIVE_WATCH_MS = 700;

type Listener = (view: AppView) => void;

interface LayoutStore {
  getState(): AppLayoutState;
  subscribe(listener: () => void): () => void;
}

const layoutStore = appModule<LayoutStore>('"useWorkspaceLayoutStore",{enumerable', (module) => {
  const store = (module as { useWorkspaceLayoutStore?: Partial<LayoutStore> } | null)?.useWorkspaceLayoutStore;
  return typeof store?.getState === "function" && typeof store.subscribe === "function" ? (store as LayoutStore) : null;
});

let store: LayoutStore | null = null;

function webView(): AppView {
  // Starts the lookup, or a new one after a failure; a later call has the store.
  if (!store) void layoutStore().then((found) => (store ??= found));
  const shown = shownFromPath(window.location.pathname);
  // Without the store, the URL still gives the shown workspace, but no selected tabs.
  return store ? layoutView(store.getState(), shown) : { shown, tabOf: () => undefined };
}

function watchWeb(listener: Listener): () => void {
  const emit = () => listener(webView());
  // The store tells about tab changes; the interval covers URL changes and a late store.
  let unsubscribe: (() => void) | null = null;
  const timer = setInterval(() => {
    if (store && !unsubscribe) unsubscribe = store.subscribe(emit);
    emit();
  }, WEB_WATCH_MS);
  window.addEventListener("popstate", emit);
  emit();
  return () => {
    clearInterval(timer);
    unsubscribe?.();
    window.removeEventListener("popstate", emit);
  };
}

// Known limit: the saved copy has no sheets, so the native highlight shows the tab under an open sheet.
async function readNativeView(): Promise<AppView | null> {
  const state = await readSavedLayout();
  // The route after the read: the user can move while the storage answers.
  const shown = shownWorkspace();
  return state && shown !== undefined ? layoutView(state, shown) : null;
}

function watchNative(listener: Listener): () => void {
  let reading = false;
  const tick = () => {
    if (reading || AppState.currentState !== "active") return;
    reading = true;
    void readNativeView().then((view) => {
      reading = false;
      if (view) listener(view);
    });
  };
  const timer = setInterval(tick, NATIVE_WATCH_MS);
  tick();
  return () => clearInterval(timer);
}

/** Calls `listener` with what the app shows, at each change or at short intervals. Returns the cleanup. */
export function watchAppView(listener: Listener): () => void {
  return Platform.OS === "web" ? watchWeb(listener) : watchNative(listener);
}
