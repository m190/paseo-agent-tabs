import type { PluginCommandCapabilities } from "@getpaseo/plugin/client";
import type { Tab, TabList } from "../shared/tabs";

// The app loads one copy of this plugin for each host, and each copy has its own modules. The sidebar shows
// one copy's item, picked by the host of the open screen. So the copies share their state through one
// object on `globalThis`: each copy adds its host's list, and every view reads the lists of all hosts.
// Change the key when the shape changes, so copies of different versions do not read each other's state.
const KEY = "__paseoAgentTabs_v1";

export type Rpc = PluginCommandCapabilities["rpc"];

export interface TabsSnapshot extends TabList {
  loaded: boolean;
}

/** One host's list, kept up to date by that host's plugin copy. */
export interface HostSource {
  /** Null until the first answer of the host's plugin server. */
  serverId: string | null;
  snapshot: TabsSnapshot;
  /** Calls the plugin server on this host. */
  rpc: Rpc;
  /** Reads the list now instead of at the next interval. */
  pollNow(): void;
}

/** The highlighted row: the tab that the app shows, or the user's last click (see active-tab.ts). */
export interface ActiveTab {
  serverId: string;
  tab: Tab;
  /** Epoch ms of the plugin click that opened the tab. Unset when the app's own tab bar selected it. */
  openedAt?: number;
}

interface Shared {
  sources: Set<HostSource>;
  /** Changes on every update, so `useSyncExternalStore` sees a new value. */
  sourcesList: readonly HostSource[];
  sourceListeners: Set<() => void>;
  active: ActiveTab | null;
  activeListeners: Set<() => void>;
  /** The last link padding for each `<server>/<workspace>`, see navigation.ts. */
  padding: Map<string, number>;
  /** Stops the repeated link of the last open, see navigation.ts. Optional: older copies do not set it. */
  cancelReopen?: () => void;
  /** The last scroll position of each list, see scroll.ts. Optional: older copies do not set it. */
  scroll?: Map<string, number>;
  /** The app's navigation (native app), see app/route.ts. */
  navigation?: AppNavigation;
  /** The app's own functions to open a tab, see app/opener.tsx. Optional: older copies do not set it. */
  tabOpeners?: Set<TabOpener>;
  /** The number of sidebar views on screen, see ui.tsx. Optional: older copies do not set it. */
  views?: number;
  viewListeners?: Set<() => void>;
}

function shared(): Shared {
  const global = globalThis as { [KEY]?: Shared };
  global[KEY] ??= {
    sources: new Set(),
    sourcesList: [],
    sourceListeners: new Set(),
    active: null,
    activeListeners: new Set(),
    padding: new Map(),
  };
  return global[KEY];
}

function listen<T>(listeners: Set<T>, listener: T): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ---------- Host lists ----------

export function addSource(source: HostSource): () => void {
  const state = shared();
  state.sources.add(source);
  sourceChanged();
  return () => {
    state.sources.delete(source);
    sourceChanged();
  };
}

/** Call after a change of a source's `snapshot` or `serverId`. */
export function sourceChanged(): void {
  const state = shared();
  state.sourcesList = [...state.sources];
  for (const listener of state.sourceListeners) listener();
}

export function subscribeSources(listener: () => void): () => void {
  return listen(shared().sourceListeners, listener);
}

/** The sources in the order they were added. After a plugin reload, the newer copy of a host comes last. */
export function getSources(): readonly HostSource[] {
  return shared().sourcesList;
}

export function sourceFor(serverId: string): HostSource | undefined {
  return [...getSources()].reverse().find((source) => source.serverId === serverId);
}

// ---------- Active tab ----------

export function getActive(): ActiveTab | null {
  return shared().active;
}

export function setActive(active: ActiveTab | null): void {
  const state = shared();
  state.active = active;
  for (const listener of state.activeListeners) listener();
}

export function subscribeActive(listener: () => void): () => void {
  return listen(shared().activeListeners, listener);
}

// ---------- App navigation (native app) ----------

export interface AppNavigation {
  getCurrentRoute(): { name?: string; params?: Record<string, unknown> } | undefined;
}

export function getAppNavigation(): AppNavigation | undefined {
  return shared().navigation;
}

export function setAppNavigation(navigation: AppNavigation): void {
  shared().navigation = navigation;
}

// ---------- The app's own functions to open a tab ----------

/** True when the app got the request; false when the opener is not for this kind, or the app does not know the tab. */
export type TabOpener = (serverId: string, tab: Pick<Tab, "kind" | "id">) => boolean;

/** Call while the opener can be used. Returns the cleanup. */
export function addTabOpener(open: TabOpener): () => void {
  const state = shared();
  state.tabOpeners ??= new Set();
  return listen(state.tabOpeners, open);
}

/** Opens the tab with the newest opener that can. False when there is none. */
export function openTabInApp(serverId: string, tab: Pick<Tab, "kind" | "id">): boolean {
  for (const open of [...(shared().tabOpeners ?? [])].reverse()) {
    try {
      if (open(serverId, tab)) return true;
    } catch {
      // Try the next opener.
    }
  }
  return false;
}

// ---------- Sidebar view ----------
//
// The user can select the plugin's sidebar view in the app's settings. The view and the sidebar item show
// the same list, and one copy draws the view while another can draw the item. So the view says here that
// it is on screen, and the item hides.

/** Call while a sidebar view is on screen. Returns the cleanup. */
export function showSidebarView(): () => void {
  changeViews(1);
  return () => changeViews(-1);
}

function changeViews(by: number): void {
  const state = shared();
  state.views = (state.views ?? 0) + by;
  for (const listener of state.viewListeners ?? []) listener();
}

export function sidebarViewShown(): boolean {
  return (shared().views ?? 0) > 0;
}

export function subscribeSidebarView(listener: () => void): () => void {
  const state = shared();
  state.viewListeners ??= new Set();
  return listen(state.viewListeners, listener);
}

// ---------- Link padding ----------

export function linkPadding(): Map<string, number> {
  return shared().padding;
}

// ---------- Scroll positions ----------

export function scrollPositions(): Map<string, number> {
  const state = shared();
  state.scroll ??= new Map();
  return state.scroll;
}

// ---------- Repeated open ----------

/** Stops the repeats of the last open and keeps `cancel` for the next one. */
export function replaceReopen(cancel: (() => void) | null): void {
  const state = shared();
  state.cancelReopen?.();
  state.cancelReopen = cancel ?? undefined;
}
