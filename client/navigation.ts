import { Linking, Platform } from "react-native";
import { withTimeout } from "../shared/async";
import type { Tab } from "../shared/tabs";
import { nextPadding, tabRoute } from "../shared/route";
import { setActiveTab } from "./active-tab";
import { getActive, linkPadding, replaceReopen } from "./hub";

// This plugin typechecks without the DOM library. Declare only what this module uses.
declare const window: {
  history: { pushState(state: unknown, unused: string, url: string): void };
  dispatchEvent(event: unknown): boolean;
};
declare const document: { scripts: ArrayLike<{ src: string }> };
declare const PopStateEvent: new (type: string, init?: { state?: unknown }) => unknown;
declare function fetch(url: string): Promise<{ ok: boolean; text(): Promise<string> }>;

export interface Navigation {
  openWorkspace?(input: { workspaceId: string; serverId?: string }): void;
  openAgent?(input: { agentId: string; serverId?: string }): void;
}

const BUNDLE = /\/_expo\/static\/js\/web\/index-[^/]+\.js/;
const LOOKUP_TIMEOUT_MS = 4_000;
const CLICK_WAIT_MS = 1_500;
const RETRY_MS = 30_000;

// ---------- The app's in-place navigation (web and desktop) ----------
//
// A history change makes the app reset its whole navigation, so the window draws again. The app has its
// own `navigateToHostWorkspaceRoute(route)` for this case. The plugin runs in the app's page, so it finds
// that module in the app bundle and calls it through Metro's `__r`. This depends on the app's build: when
// the lookup fails, the plugin uses the history change, which works but redraws the window.

type RouteNavigator = (route: string) => void;

let lookup: Promise<RouteNavigator | null> | null = null;
let failedAt = 0;

async function findNavigator(): Promise<RouteNavigator | null> {
  const metroRequire = (globalThis as { __r?: (id: number) => unknown }).__r;
  if (typeof metroRequire !== "function") return null;
  const sources = Array.from(document.scripts, (script) => script.src).filter((src) => BUNDLE.test(src));
  for (const src of sources) {
    try {
      const response = await fetch(src);
      if (!response.ok) continue;
      const code = await response.text();
      const at = code.indexOf("navigateToHostWorkspaceRoute=function");
      if (at < 0) continue;
      const moduleId = /\},(\d+),\[[\d,]*\]\);/.exec(code.slice(at))?.[1];
      if (!moduleId) continue;
      const module = metroRequire(Number(moduleId)) as { navigateToHostWorkspaceRoute?: unknown } | null;
      const navigate = module?.navigateToHostWorkspaceRoute;
      if (typeof navigate === "function") return (route) => (navigate as RouteNavigator)(route);
    } catch {
      // Try the next bundle.
    }
  }
  return null;
}

/** Starts the lookup, or starts it again some time after a failure. */
export function prepareNavigation(): Promise<RouteNavigator | null> | null {
  if (Platform.OS !== "web") return null;
  if (!lookup || (failedAt > 0 && Date.now() - failedAt > RETRY_MS)) {
    failedAt = 0;
    lookup = withTimeout(findNavigator(), LOOKUP_TIMEOUT_MS, "Navigation lookup timed out")
      .catch(() => null)
      .then((navigate) => {
        if (!navigate) failedAt = Date.now();
        return navigate;
      });
  }
  return lookup;
}

function pushRoute(route: string): void {
  window.history.pushState(null, "", route);
  window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
}

async function navigateWeb(route: string): Promise<void> {
  const pending = prepareNavigation();
  const navigate = pending ? await withTimeout(pending, CLICK_WAIT_MS, "").catch(() => null) : null;
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

// The app removes a tab from a workspace when the tab's terminal (or agent) is not in the app's own list
// for that workspace. The app refreshes that list only while it shows the workspace. So a link to a tab that
// is new to the app (a tab the plugin just created, or one created on another device) opens the workspace,
// and then the app removes the tab again and shows the tab that was open before. When the refreshed list
// arrives, the app adds the tab in the background. The plugin cannot read the app's list, so it sends the
// link again after the refresh. When the first link worked, the repeats only open the tab that is open.
const REOPEN_MS = [1_000, 2_500];

export function openTab(serverId: string, tab: Tab, navigation?: Navigation): void {
  setActiveTab(serverId, tab);
  sendLink(serverId, tab, navigation);
  const timers = REOPEN_MS.map((delay) =>
    setTimeout(() => {
      // Stop when the user opened another tab, or (on web) left the workspace.
      const active = getActive();
      if (active?.serverId === serverId && active.tab.id === tab.id) sendLink(serverId, tab, navigation);
    }, delay),
  );
  replaceReopen(() => timers.forEach(clearTimeout));
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
