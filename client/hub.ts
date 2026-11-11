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

/** The tab the user opened last from the plugin. */
export interface ActiveTab {
  serverId: string;
  tab: Tab;
  /** True once the app showed the tab's workspace; before that, the navigation is on its way. */
  arrived: boolean;
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

function listen(listeners: Set<() => void>, listener: () => void): () => void {
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

// ---------- Link padding ----------

export function linkPadding(): Map<string, number> {
  return shared().padding;
}

// ---------- Repeated open ----------

/** Stops the repeats of the last open and keeps `cancel` for the next one. */
export function replaceReopen(cancel: (() => void) | null): void {
  const state = shared();
  state.cancelReopen?.();
  state.cancelReopen = cancel ?? undefined;
}
