import { Linking, Platform } from "react-native";
import { withTimeout } from "../shared/async";
import { sameTab } from "../shared/app-view";
import { nextPadding, tabRoute } from "../shared/route";
import type { Tab } from "../shared/tabs";
import { setActiveTab } from "./active-tab";
import { appModule } from "./app/bundle";
import { getActive, linkPadding, replaceReopen } from "./hub";

// This plugin typechecks without the DOM library. Declare only what this module uses.
declare const window: {
  history: { pushState(state: unknown, unused: string, url: string): void };
  dispatchEvent(event: unknown): boolean;
  addEventListener(type: "pointerdown" | "keydown" | "popstate", listener: (event: { isTrusted: boolean }) => void, options: { capture: boolean }): void;
  removeEventListener(type: "pointerdown" | "keydown" | "popstate", listener: (event: { isTrusted: boolean }) => void, options: { capture: boolean }): void;
};
declare const PopStateEvent: new (type: string, init?: { state?: unknown }) => unknown;

export interface Navigation {
  openWorkspace?(input: { workspaceId: string; serverId?: string }): void;
  openAgent?(input: { agentId: string; serverId?: string }): void;
}

const CLICK_WAIT_MS = 1_500;

// ---------- The app's in-place navigation (web and desktop) ----------
//
// A history change makes the app reset its whole navigation, so the window draws again. The app has its
// own `navigateToHostWorkspaceRoute(route)` for this case, which the plugin finds in the app bundle (see
// app/bundle.ts). When the lookup fails, the plugin uses the history change, which works but redraws the window.

type RouteNavigator = (route: string) => void;

const routeNavigator = appModule<RouteNavigator>("navigateToHostWorkspaceRoute=function", (module) => {
  const navigate = (module as { navigateToHostWorkspaceRoute?: unknown } | null)?.navigateToHostWorkspaceRoute;
  return typeof navigate === "function" ? (route) => (navigate as RouteNavigator)(route) : null;
});

/** Starts the lookup early, so the first click does not wait for it. */
export function prepareNavigation(): void {
  if (Platform.OS === "web") void routeNavigator();
}

function pushRoute(route: string): void {
  window.history.pushState(null, "", route);
  window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
}

async function navigateWeb(route: string): Promise<void> {
  const navigate = await withTimeout(routeNavigator(), CLICK_WAIT_MS, "").catch(() => null);
  if (navigate) {
    try {
      navigate(route);
      return;
    } catch {
      // Use the history change below.
    }
  }
  pushRoute(route);
}

// ---------- Opening a tab ----------
//
// The app removes a tab from a workspace when the tab's terminal (or agent) is not in the app's own list
// for that workspace. The app refreshes that list only while it shows the workspace. So a link to a tab that
// is new to the app (a tab the plugin just created, or one created on another device) opens the workspace,
// and then the app removes the tab again and selects another tab. When the refreshed list arrives, the app
// adds the tab in the background. The plugin cannot read the app's list, so it sends the link again after the
// refresh. When the first link worked, the repeats only open the tab that is open.
//
// Known limit: in the native app, a tab that the user selects in the app's tab bar during the repeats
// (2.5 s) is undone. The plugin cannot tell this choice from the stale list without an API of the app.

const REOPEN_MS = [1_000, 2_500];

export function openTab(serverId: string, tab: Tab, navigation?: Navigation): void {
  setActiveTab(serverId, tab);
  sendLink(serverId, tab, navigation);
  const timers = REOPEN_MS.map((delay, index) =>
    setTimeout(() => {
      // The highlight stays on this tab during the repeats (see active-tab.ts) unless the user closed it.
      const active = getActive();
      if (active?.serverId === serverId && sameTab(active.tab, tab)) sendLink(serverId, tab, navigation);
      if (index === REOPEN_MS.length - 1) stopWatching();
    }, delay),
  );
  // On web and desktop, the next click, key press, or browser Back stops the repeats. Without this, the
  // repeats would undo a tab that the user selects in the app's own tab bar.
  const cancel = () => {
    timers.forEach(clearTimeout);
    stopWatching();
  };
  const stopWatching = Platform.OS === "web" ? onNextInput(cancel) : () => {};
  // A new click cancels the last one, also in another host's plugin copy.
  replaceReopen(cancel);
}

/**
 * Calls `callback` at the next pointer press, key press, or browser Back/Forward in the page. Returns the
 * cleanup. The plugin's own history change (`pushRoute`) sends an untrusted popstate, which does not count.
 */
function onNextInput(callback: () => void): () => void {
  const options = { capture: true };
  const listener = () => callback();
  const onHistory = (event: { isTrusted: boolean }) => {
    if (event.isTrusted) callback();
  };
  window.addEventListener("pointerdown", listener, options);
  window.addEventListener("keydown", listener, options);
  window.addEventListener("popstate", onHistory, options);
  return () => {
    window.removeEventListener("pointerdown", listener, options);
    window.removeEventListener("keydown", listener, options);
    window.removeEventListener("popstate", onHistory, options);
  };
}

// In the Android app, a link with the same `open` value as the route already holds does nothing, so a second
// tap on the open tab does not close the drawer. Tests show the route compares the trimmed value; why it keeps
// the old value is not known. Spaces after the colon change the value but not the tab (the parser trims the id).
// The padding is random, so a plugin reload does not start from a value that the route still holds. The last
// padding lives in the shared hub, because each host's plugin copy can send the link.
function sendLink(serverId: string, tab: Tab, navigation?: Navigation): void {
  if (Platform.OS === "web") {
    void navigateWeb(tabRoute(serverId, tab));
    return;
  }
  const routeKey = `${serverId}/${tab.workspaceId}`;
  const lastPadding = linkPadding();
  const padding = nextPadding(lastPadding.get(routeKey));
  lastPadding.set(routeKey, padding);
  Linking.openURL(`paseo:/${tabRoute(serverId, tab, padding)}`).catch(() => {
    setActiveTab(serverId, null);
    replaceReopen(null);
    fallback(serverId, tab, navigation);
  });
}

function fallback(serverId: string, tab: Tab, navigation?: Navigation): void {
  if (tab.kind === "agent" && navigation?.openAgent) navigation.openAgent({ agentId: tab.id, serverId });
  else navigation?.openWorkspace?.({ workspaceId: tab.workspaceId, serverId });
}
