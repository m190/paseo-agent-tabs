import { useSyncExternalStore } from "react";
import { type AppView, nextHighlight, sameTab, type TabRef } from "../shared/app-view";
import type { Tab } from "../shared/tabs";
import { watchAppView } from "./app/view";
import { getActive, setActive, sourceFor, subscribeActive } from "./hub";
import { tabKey } from "./model";

// The highlighted row: the tab that the app shows (see app/view.ts), so a tab selected in the app's own tab
// bar is highlighted too. When the plugin cannot read the app, the highlight is the user's last click in the
// plugin. The value lives in the shared hub: the sidebar can show another host's copy after a navigation.

/**
 * How long the highlight stays on a clicked tab while the app still opens it. Keep it longer than the link
 * repeats in navigation.ts: they stop when the highlight leaves their tab.
 */
const OPENING_MS = 4_000;

/** The tab the user opened from the plugin; null when opening it failed. */
export function setActiveTab(serverId: string, tab: Tab | null): void {
  setActive(tab ? { serverId, tab, openedAt: Date.now() } : null);
}

/** The plugin's row for a tab; null when the tab's host has no plugin, or the list does not have it yet. */
function findTab(serverId: string, ref: TabRef): Tab | null {
  for (const group of sourceFor(serverId)?.snapshot.groups ?? []) {
    const tab = group.tabs.find((item) => sameTab(item, ref));
    if (tab) return tab;
  }
  return null;
}

function follow(view: AppView): void {
  // Another screen than a workspace keeps the highlight.
  if (!view.shown) return;
  const { serverId, ref } = view.shown;
  const selected = view.tabOf(ref);
  if (selected === undefined) return;
  const active = getActive();
  const next = nextHighlight(serverId, selected, active, Date.now(), OPENING_MS);
  if (next === undefined) return;
  const tab = next ? findTab(serverId, next) : null;
  if (tab) setActive({ serverId, tab });
  else if (active) setActive(null);
}

/** Makes the highlight follow the app's selected tab. Returns the cleanup. */
export function watchActiveTab(): () => void {
  return watchAppView(follow);
}

function activeKey(): string | null {
  const active = getActive();
  return active ? tabKey(active.serverId, active.tab) : null;
}

export function useActiveKey(): string | null {
  return useSyncExternalStore(subscribeActive, activeKey, activeKey);
}
