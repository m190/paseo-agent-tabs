import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type AppLayoutState,
  layoutView,
  nextHighlight,
  sameTab,
  shownFromPath,
  workspaceRef,
} from "../shared/app-view";

type TestTab = { tabId: string; target: { kind: string; terminalId?: string; agentId?: string } };
const terminal = (id: string): TestTab => ({ tabId: `terminal_${id}`, target: { kind: "terminal", terminalId: id } });
const pane = (id: string, tabs: TestTab[], focusedTabId: string | null) => ({ kind: "pane" as const, pane: { id, tabs, focusedTabId } });

// The shape the app keeps: a horizontal group with the main pane and the explorer sidebar pane.
function state(workspaceId: string, focusedPaneId: string, mainFocus: string | null): AppLayoutState {
  const key = `srv_1:${workspaceId}`;
  const main = [terminal("a"), terminal("b"), { tabId: "agent_c", target: { kind: "agent", agentId: "c" } }, { tabId: "f", target: { kind: "file" } }];
  return {
    layoutByWorkspace: {
      "srv_1:wks_other": { root: pane("main", [terminal("x")], "terminal_x"), focusedPaneId: "main" },
      [key]: {
        focusedPaneId,
        root: { kind: "group", group: { children: [pane("main", main, mainFocus), pane("explorer", [{ tabId: "files", target: { kind: "files" } }], "files")] } },
      },
    },
    explorerSidebarPaneIdByWorkspace: { [key]: "explorer" },
  };
}

const T = (id: string) => ({ kind: "terminal", id });

test("the selected tab of each workspace", () => {
  const ref = workspaceRef("srv_1", "wks_1");
  assert.deepEqual(layoutView(state("wks_1", "main", "terminal_b"), null).tabOf(ref), T("b"));
  assert.deepEqual(layoutView(state("wks_1", "main", "agent_c"), null).tabOf(ref), { kind: "agent", id: "c" });
  assert.equal(layoutView(state("wks_1", "main", "f"), null).tabOf(ref), null);
  assert.deepEqual(layoutView(state("wks_1", "main", "f"), null).tabOf(workspaceRef("srv_1", "wks_other")), T("x"));
});

test("no selected tab for the explorer pane or an unknown workspace", () => {
  const view = layoutView(state("wks_1", "explorer", "terminal_b"), null);
  assert.equal(view.tabOf(workspaceRef("srv_1", "wks_1")), undefined);
  assert.equal(view.tabOf(workspaceRef("srv_2", "wks_1")), undefined);
  assert.equal(layoutView({}, null).tabOf(workspaceRef("srv_1", "wks_1")), undefined);
  // The saved state (native app) names the explorer pane explorerPaneIdByWorkspace.
  const saved = state("wks_1", "explorer", "terminal_b");
  saved.explorerPaneIdByWorkspace = saved.explorerSidebarPaneIdByWorkspace;
  delete saved.explorerSidebarPaneIdByWorkspace;
  assert.equal(layoutView(saved, null).tabOf(workspaceRef("srv_1", "wks_1")), undefined);
});

test("a sheet above the panes (compact layout) is the selected tab", () => {
  const withSheet = state("wks_1", "main", "terminal_b");
  withSheet.sheetsByWorkspace = { "srv_1:wks_1": [{ tab: terminal("a") }, { tab: { tabId: "agent_s", target: { kind: "agent", agentId: "s" } } }] };
  assert.deepEqual(layoutView(withSheet, null).tabOf(workspaceRef("srv_1", "wks_1")), { kind: "agent", id: "s" });
  withSheet.sheetsByWorkspace = { "srv_1:wks_1": [] };
  assert.deepEqual(layoutView(withSheet, null).tabOf(workspaceRef("srv_1", "wks_1")), T("b"));
});

test("the shown workspace from a path, also for a workspace id that is not a safe path segment", () => {
  assert.deepEqual(shownFromPath("/h/srv_1/workspace/wks_1"), { serverId: "srv_1", ref: workspaceRef("srv_1", "wks_1") });
  assert.equal(shownFromPath("/settings"), null);
  const id = "/Users/me/repo";
  const shown = shownFromPath(`/h/srv_1/workspace/b64_${Buffer.from(id).toString("base64url")}`)!;
  assert.equal(shown.ref, workspaceRef("srv_1", id));
  assert.deepEqual(layoutView(state(id, "main", "terminal_a"), shown).tabOf(shown.ref), T("a"));
});

test("a null tab (a file) is the same as another null tab, never as a terminal", () => {
  assert.equal(sameTab(null, null), true);
  assert.equal(sameTab(T("a"), null), false);
  assert.equal(sameTab(T("a"), T("a")), true);
  assert.equal(sameTab(T("a"), { kind: "agent", id: "a" }), false);
});

test("the highlight follows the app's selection, also after a click in the plugin changed it", () => {
  const rowA = { serverId: "srv_1", tab: T("a") };
  assert.equal(nextHighlight("srv_1", T("a"), rowA, 0, 4_000), undefined);
  assert.deepEqual(nextHighlight("srv_1", T("a"), null, 0, 4_000), T("a"));
  // The plugin opened B at 10 s, and the app still (or again) shows A.
  const clickedB = { serverId: "srv_1", tab: T("b"), openedAt: 10_000 };
  assert.equal(nextHighlight("srv_1", T("a"), clickedB, 12_000, 4_000), undefined);
  assert.deepEqual(nextHighlight("srv_1", T("a"), clickedB, 14_000, 4_000), T("a"));
  // The same tab id on another host is another row.
  assert.deepEqual(nextHighlight("srv_1", T("a"), { ...rowA, serverId: "srv_2" }, 0, 4_000), T("a"));
  // A selected file clears the highlight; nothing selected and nothing highlighted keeps it.
  assert.equal(nextHighlight("srv_1", null, rowA, 0, 4_000), null);
  assert.equal(nextHighlight("srv_1", null, null, 0, 4_000), undefined);
});
