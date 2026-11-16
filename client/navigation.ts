import { Linking, Platform } from "react-native";
import { withTimeout } from "../shared/async";
import { sameTab, workspaceRef } from "../shared/app-view";
import { type AppOpenInput, appOpenInput, nextPadding, tabRoute } from "../shared/route";
import type { Tab } from "../shared/tabs";
import { setActiveTab } from "./active-tab";
import { appModule } from "./app/bundle";
import { selectedTabNow } from "./app/view";
import { getActive, linkPadding, openTabInApp, replaceReopen } from "./hub";

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

// ---------- The ways to open a tab ----------
//
// The app must select the tab BEFORE it shows the workspace. If the app shows the workspace first, it shows
// the workspace's last tab for one render and reports that tab as seen, so the "done" state of a tab that the
// user did not open goes away. The plugin uses the first way that is available:
//
// 1. The app's functions for plugins (see app/opener.tsx). They select the tab first, on every platform.
// 2. Web and desktop: `navigateToWorkspace(input)` from the app bundle (see app/bundle.ts), which is the
//    function behind 1. It is for an older app, for a tab that the app's lists do not have yet, and for an
//    agent tab while no view with a function for agents is on screen.
// 3. The route with `?open=`, for which the app shows the workspace first. On web and desktop the route goes
//    to `navigateToHostWorkspaceRoute(route)` from the app bundle, or into a history change, which makes the
//    app reset its whole navigation, so the window draws again. In the native app the route is a link.

type WorkspaceNavigator = (input: AppOpenInput) => void;
type RouteNavigator = (route: string) => void;

function appFunction<T>(name: string): () => Promise<T | null> {
  return appModule<T>(`${name}=function`, (module) => {
    const found = (module as Record<string, unknown> | null)?.[name];
    return typeof found === "function" ? (found as T) : null;
  });
}

const workspaceNavigator = appFunction<WorkspaceNavigator>("navigateToWorkspace");
const routeNavigator = appFunction<RouteNavigator>("navigateToHostWorkspaceRoute");

/** Starts the lookups early, so the first click does not wait for them. */
export function prepareNavigation(): void {
  if (Platform.OS !== "web") return;
  void workspaceNavigator();
  void routeNavigator();
}

function pushRoute(route: string): void {
  window.history.pushState(null, "", route);
  window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
}

/**
 * Ways 2 and 3 on web and desktop. The two lookups read the same bundle, so they end together. The wait for
 * them can be long after the page loads; the user can make another choice in that time, and then `wanted` is
 * false and this request stops.
 */
async function navigateWeb(serverId: string, tab: Tab, wanted: () => boolean): Promise<void> {
  const lookups = Promise.all([workspaceNavigator(), routeNavigator()]);
  const [openInWorkspace, showRoute] = await withTimeout(lookups, CLICK_WAIT_MS, "").catch(() => [null, null]);
  if (!wanted()) return;
  const route = tabRoute(serverId, tab);
  const ways = [
    openInWorkspace && (() => openInWorkspace(appOpenInput(serverId, tab))),
    showRoute && (() => showRoute(route)),
    () => pushRoute(route),
  ];
  for (const way of ways) {
    if (!way) continue;
    try {
      way();
      return;
    } catch {
      // Use the next way.
    }
  }
}

// ---------- Opening a tab ----------
//
// The app removes a tab from a workspace when the tab's terminal (or agent) is not in the app's own list
// for that workspace. The app refreshes that list only while it shows the workspace. So a link to a tab that
// is new to the app (a tab the plugin just created, or one created on another device) opens the workspace,
// and then the app removes the tab again and selects another tab. When the refreshed list arrives, the app
// adds the tab in the background. The plugin cannot read the app's list, so it sends the link again after the
// refresh.
//
// A repeat is a navigation: in the native app it closes a drawer that the user opened again, and it undoes
// a tab that the user selects in the app's tab bar. So before each repeat, the plugin reads the app. When the
// tab is the selected tab of its workspace, the link worked and the repeats stop: a later change of the tab
// is the user's own choice. When the plugin cannot read the app, it sends each repeat.
//
// Known limit: in the native app, a tab that the user selects in the app's tab bar before the plugin saw the
// opened tab (1 s, or 2.5 s for a tab that is new to the app) is undone. The plugin cannot tell this choice
// from the stale list without an API of the app.

const REOPEN_MS = [1_000, 2_500];

/** True when the tab is the selected tab of its workspace in the app. False also when the plugin cannot read the app. */
async function appShowsTab(serverId: string, tab: Tab): Promise<boolean> {
  const selected = await selectedTabNow(workspaceRef(serverId, tab.workspaceId)).catch(() => undefined);
  return selected != null && sameTab(selected, tab);
}

/** True while the tab is the last one that the user opened from the plugin, and the user did not close it. */
function isWanted(serverId: string, tab: Tab): boolean {
  const active = getActive();
  return active?.serverId === serverId && sameTab(active.tab, tab);
}

/** Asks the app one time to show the tab, with the first way that is available. Stops when `wanted` becomes false. */
async function show(serverId: string, tab: Tab, wanted: () => boolean, navigation?: Navigation): Promise<void> {
  if (openTabInApp(serverId, tab)) return;
  if (Platform.OS === "web") await navigateWeb(serverId, tab, wanted);
  else sendLink(serverId, tab, navigation);
}

export function openTab(serverId: string, tab: Tab, navigation?: Navigation): void {
  setActiveTab(serverId, tab);
  // The first request stops at the next open from the plugin. A repeat stops also at the user's next input
  // in the app (see `cancel`): the user's own choice of a tab is kept.
  const wanted = () => isWanted(serverId, tab);
  void show(serverId, tab, wanted, navigation);
  let stopped = false;
  const repeat = async () => {
    const shown = await appShowsTab(serverId, tab);
    if (stopped) return;
    if (shown) return cancel();
    // The highlight stays on this tab during the repeats (see active-tab.ts).
    if (wanted()) await show(serverId, tab, () => !stopped && wanted(), navigation);
  };
  const timers = REOPEN_MS.map((delay, index) =>
    setTimeout(() => {
      const done = repeat();
      // The watch for the user's input ends when the last repeat ends.
      if (index === REOPEN_MS.length - 1) void done.then(stopWatching, stopWatching);
    }, delay),
  );
  // On web and desktop, the next click, key press, or browser Back stops the repeats. Without this, the
  // repeats would undo a tab that the user selects in the app's own tab bar.
  const cancel = () => {
    stopped = true;
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
