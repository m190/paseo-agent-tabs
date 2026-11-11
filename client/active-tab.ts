import { useSyncExternalStore } from "react";
import { Platform } from "react-native";
import { workspaceSegment } from "../shared/route";
import type { Tab } from "../shared/tabs";
import { type ActiveTab, getActive, setActive, subscribeActive } from "./hub";
import { tabKey } from "./model";

// This plugin typechecks without the DOM library. Declare only what this module uses.
declare const window: {
  location: { pathname: string };
  addEventListener(type: "popstate", listener: () => void): void;
  removeEventListener(type: "popstate", listener: () => void): void;
};

const WATCH_MS = 500;

// The tab the user opened from the plugin. The app gives plugins no way to read its selected tab, so the
// plugin remembers its own last click. On web it forgets the tab when the user leaves that workspace.
// The value lives in the shared hub: the sidebar can show another host's copy after a navigation.

/** The tab the user opened last; null when opening it failed. */
export function setActiveTab(serverId: string, tab: Tab | null): void {
  if (!tab) {
    setActive(null);
    return;
  }
  // A click on a tab of the open workspace does not change the URL, so check it now.
  const active: ActiveTab = { serverId, tab, arrived: false };
  active.arrived = Platform.OS === "web" && inWorkspace(window.location.pathname, active);
  setActive(active);
}

function inWorkspace(pathname: string, active: ActiveTab): boolean {
  return pathname.includes(`/h/${encodeURIComponent(active.serverId)}/workspace/${workspaceSegment(active.tab.workspaceId)}`);
}

function onLocation(pathname: string): void {
  const active = getActive();
  if (!active) return;
  const here = inWorkspace(pathname, active);
  if (here && !active.arrived) active.arrived = true;
  else if (!here && active.arrived) setActive(null);
}

/** Follows the URL on web and desktop. Returns the cleanup. */
export function watchActiveTab(): () => void {
  if (Platform.OS !== "web") return () => {};
  let last = "";
  const check = () => {
    const pathname = window.location.pathname;
    if (pathname === last) return;
    last = pathname;
    onLocation(pathname);
  };
  const timer = setInterval(check, WATCH_MS);
  window.addEventListener("popstate", check);
  return () => {
    clearInterval(timer);
    window.removeEventListener("popstate", check);
  };
}

function activeKey(): string | null {
  const active = getActive();
  return active ? tabKey(active.serverId, active.tab) : null;
}

export function useActiveKey(): string | null {
  return useSyncExternalStore(subscribeActive, activeKey, activeKey);
}
