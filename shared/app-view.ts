// What the app shows: the shown workspace and the selected tab of each workspace, read from the app's
// workspace layout store. Pure, so tests can check it. The shapes are the parts of the app's state that the
// plugin reads; client/app/ reads them on each platform.

import { workspaceSegment } from "./route";

// ---------- The app's layout state ----------

interface AppTab {
  tabId: string;
  target?: { kind?: string; terminalId?: string; agentId?: string };
}

interface AppPane {
  id: string;
  tabs?: AppTab[];
  focusedTabId?: string | null;
}

type AppNode = { kind: "pane"; pane: AppPane } | { kind: "group"; group: { children?: AppNode[] } };

export interface AppLayoutState {
  /** Keyed by `<serverId>:<workspaceId>`. */
  layoutByWorkspace?: Record<string, { root?: AppNode; focusedPaneId?: string } | undefined>;
  explorerSidebarPaneIdByWorkspace?: Record<string, string | undefined>;
  /** The saved copy of the state (native app) uses this older name. */
  explorerPaneIdByWorkspace?: Record<string, string | undefined>;
  /** Compact layout: tabs shown above the panes, the last one on top. Not in the saved copy. */
  sheetsByWorkspace?: Record<string, { tab?: AppTab }[] | undefined>;
}

// ---------- The view ----------

/** A terminal or an agent. */
export interface TabRef {
  kind: string;
  id: string;
}

/** Null is "no terminal or agent", for example a file: two nulls are the same selection. */
export function sameTab(a: TabRef | null, b: TabRef | null): boolean {
  return a === null || b === null ? a === b : a.kind === b.kind && a.id === b.id;
}

/** One key for a workspace, whether the app gives its id or its path segment. */
export function workspaceRef(serverId: string, workspace: string): string {
  return `${serverId}:${workspaceSegment(workspace)}`;
}

export interface ShownWorkspace {
  serverId: string;
  /** See `workspaceRef`. */
  ref: string;
}

export interface AppView {
  /** Null when the app shows another screen than a workspace. */
  shown: ShownWorkspace | null;
  /**
   * The selected tab of a workspace (`workspaceRef`). Null when it is not a terminal or an agent. Undefined when
   * the app has no layout for the workspace, or the explorer sidebar has the focus (its tabs are files).
   */
  tabOf(ref: string): TabRef | null | undefined;
}

function findPane(node: AppNode | undefined, paneId: string): AppPane | null {
  if (!node) return null;
  if (node.kind === "pane") return node.pane?.id === paneId ? node.pane : null;
  for (const child of node.group?.children ?? []) {
    const pane = findPane(child, paneId);
    if (pane) return pane;
  }
  return null;
}

function tabRef(target: AppTab["target"]): TabRef | null {
  if (target?.kind === "terminal" && target.terminalId) return { kind: "terminal", id: target.terminalId };
  if (target?.kind === "agent" && target.agentId) return { kind: "agent", id: target.agentId };
  return null;
}

function selectedTab(state: AppLayoutState, key: string): TabRef | null | undefined {
  const sheets = state.sheetsByWorkspace?.[key] ?? [];
  const top = sheets[sheets.length - 1]?.tab;
  if (top) return tabRef(top.target);
  const layout = state.layoutByWorkspace?.[key];
  if (!layout?.focusedPaneId) return undefined;
  const explorer = state.explorerSidebarPaneIdByWorkspace?.[key] ?? state.explorerPaneIdByWorkspace?.[key];
  if (layout.focusedPaneId === explorer) return undefined;
  const pane = findPane(layout.root, layout.focusedPaneId);
  if (!pane) return undefined;
  return tabRef(pane.tabs?.find((tab) => tab.tabId === pane.focusedTabId)?.target);
}

/** The view of a layout state and the shown workspace. */
export function layoutView(state: AppLayoutState, shown: ShownWorkspace | null): AppView {
  const tabs = new Map<string, TabRef | null>();
  for (const key of Object.keys(state.layoutByWorkspace ?? {})) {
    const colon = key.indexOf(":");
    if (colon <= 0) continue;
    const tab = selectedTab(state, key);
    if (tab !== undefined) tabs.set(workspaceRef(key.slice(0, colon), key.slice(colon + 1)), tab);
  }
  return { shown, tabOf: (ref) => tabs.get(ref) };
}

/** The workspace in a `/h/<server>/workspace/<workspace>` path (web), or null for another screen. */
export function shownFromPath(pathname: string): ShownWorkspace | null {
  const match = /\/h\/([^/]+)\/workspace\/([^/?#]+)/.exec(pathname);
  if (!match) return null;
  const serverId = decodeURIComponent(match[1]!);
  return { serverId, ref: workspaceRef(serverId, match[2]!) };
}

// ---------- The highlighted row ----------

/** The highlighted row, as far as `nextHighlight` needs it. */
export interface Highlight {
  serverId: string;
  tab: TabRef;
  /** Epoch ms of the plugin click that opened the tab. */
  openedAt?: number;
}

/**
 * What the highlight must become for the app's selected tab: undefined keeps it, null clears it, a tab
 * selects it. It uses no memory of earlier calls, so a highlight that changed in between is corrected at the
 * next call. After a click in the plugin, the app can need a few seconds to show the tab; until `openingMs`
 * passed, the highlight stays on the clicked tab.
 */
export function nextHighlight(serverId: string, tab: TabRef | null, active: Highlight | null, now: number, openingMs: number): TabRef | null | undefined {
  const same = tab === null ? active === null : active !== null && active.serverId === serverId && sameTab(active.tab, tab);
  if (same) return undefined;
  if (active?.openedAt && now - active.openedAt < openingMs) return undefined;
  return tab;
}
