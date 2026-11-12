import assert from "node:assert/strict";
import { test } from "node:test";
import { agentCounts, combine, countByStatus, foldAll, groupKey, type HostGroup, hostSections, isHidden, listLayout, orderedEntries, rollup, startsGroup, tabKey, toggleFolded, total } from "../client/model";
import type { Tab, TabGroup, TabList, TabStatus } from "../shared/tabs";

function tab(id: string, status: TabStatus, statusSince = 0): Tab {
  return { id, kind: "terminal", workspaceId: "w", title: id, agent: "claude", status, detail: null, statusSince };
}

const host = { serverId: "mac", hostLabel: "Mac" };
const groups: HostGroup[] = [
  { ...host, workspaceId: "a", projectName: "alpha", colorKey: "a", workspaceName: null, tabs: [tab("a1", "idle", 1), tab("a2", "working", 5)] },
  { ...host, workspaceId: "b", projectName: "beta", colorKey: "b", workspaceName: null, tabs: [tab("b1", "blocked", 2), tab("b2", "working", 9)] },
];

test("counts and total", () => {
  const counts = countByStatus(groups);
  assert.equal(counts.working, 2);
  assert.equal(counts.blocked, 1);
  assert.equal(total(counts), 4);
});

test("rollup takes the most urgent state", () => {
  assert.equal(rollup(groups[1]!.tabs), "blocked");
  assert.equal(rollup([]), "unknown");
});

test("spaces order keeps the workspace order and marks group starts", () => {
  const entries = orderedEntries(groups, "spaces", null);
  assert.deepEqual(entries.map((entry) => entry.tab.id), ["a1", "a2", "b1", "b2"]);
  assert.deepEqual(entries.map((_, index) => startsGroup(entries, index, "spaces")), [true, false, true, false]);
});

test("priority order sorts by state, then by the newest status change", () => {
  const entries = orderedEntries(groups, "priority", null);
  assert.deepEqual(entries.map((entry) => entry.tab.id), ["b1", "b2", "a2", "a1"]);
  assert.equal(startsGroup(entries, 0, "priority"), false);
});

test("filter keeps one state", () => {
  assert.deepEqual(orderedEntries(groups, "spaces", "working").map((entry) => entry.tab.id), ["a2", "b2"]);
});


function list(serverId: string | null, tabGroups: TabGroup[], error: string | null = null): { serverId: string | null; snapshot: TabList & { loaded: boolean } } {
  const workspaces = tabGroups.map(({ tabs: _tabs, ...info }) => info);
  return { serverId, snapshot: { serverId, groups: tabGroups, workspaces, error, loaded: true } };
}

const piGroup: TabGroup = { workspaceId: "p", projectName: "pi", colorKey: "p", workspaceName: null, tabs: [tab("p1", "blocked", 3)] };
const macGroup: TabGroup = { workspaceId: "a", projectName: "alpha", colorKey: "a", workspaceName: null, tabs: [tab("a1", "working", 1)] };
const appHosts = [
  { serverId: "mac", label: "Mac" },
  { serverId: "pi", label: "Pi" },
];

test("combine joins hosts in the app's host order, with the host on each group", () => {
  const combined = combine([list("pi", [piGroup]), list("mac", [macGroup])], appHosts);
  assert.deepEqual(combined.hosts.map((item) => item.label), ["Mac", "Pi"]);
  assert.deepEqual(combined.groups.map((group) => `${group.hostLabel}/${group.projectName}`), ["Mac/alpha", "Pi/pi"]);
  assert.deepEqual(combined.workspaces.map((workspace) => workspace.serverId), ["mac", "pi"]);
  assert.equal(combined.error, null);
  assert.equal(combined.loaded, true);
});

test("combine names the host of an error and keeps the newest copy of a host", () => {
  const old = list("pi", [piGroup]);
  const fresh = list("pi", [], "socket closed");
  const combined = combine([list("mac", [macGroup]), old, fresh, list(null, [], "no answer")], appHosts);
  assert.equal(combined.hosts.length, 2);
  assert.equal(combined.groups.length, 1);
  assert.equal(combined.error, "Pi: socket closed · no answer");
});

test("a host the app does not list shows with its server id", () => {
  assert.deepEqual(combine([list("other", [macGroup])], appHosts).hosts.map((item) => item.label), ["other"]);
});

test("the same tab id on two hosts gets two keys", () => {
  assert.notEqual(tabKey("mac", tab("x", "idle")), tabKey("pi", tab("x", "idle")));
});

test("priority order mixes the hosts", () => {
  const combined = combine([list("mac", [macGroup]), list("pi", [piGroup])], appHosts);
  assert.deepEqual(orderedEntries(combined.groups, "priority", null).map((entry) => entry.tab.id), ["p1", "a1"]);
});

test("host sections: one per host when grouped, also for a host without tabs", () => {
  const combined = combine([list("mac", [macGroup]), list("pi", [])], appHosts);
  const entries = orderedEntries(combined.groups, "spaces", null);
  const grouped = hostSections(entries, combined.hosts, "grouped");
  assert.deepEqual(grouped.map((section) => [section.host?.label, section.entries.length]), [
    ["Mac", 1],
    ["Pi", 0],
  ]);
  assert.equal(hostSections(entries, combined.hosts, "combined")[0]!.host, null);
  const single = combine([list("mac", [macGroup])], appHosts);
  assert.equal(hostSections(entries, single.hosts, "grouped")[0]!.host, null);
});

test("the filter counts leave out plain shells", () => {
  const shell: Tab = { ...tab("s1", "unknown"), agent: "shell" };
  const unknownAgent: Tab = { ...tab("u1", "unknown"), agent: "codex" };
  const withShell: HostGroup[] = [{ ...groups[0]!, tabs: [...groups[0]!.tabs, shell, unknownAgent] }];
  assert.equal(countByStatus(withShell).unknown, 2);
  assert.equal(agentCounts(withShell).unknown, 1);
  assert.equal(agentCounts(withShell).working, 1);
});

test("the default view is one list of all hosts, by state; stored values without a field get the default", async () => {
  const { DEFAULT_VIEW, viewSchema } = await import("../shared/view-settings");
  assert.deepEqual(DEFAULT_VIEW, { sort: "priority", collapsed: false, hosts: "combined", folded: [] });
  assert.deepEqual(viewSchema.parse({ sort: "spaces" }), { sort: "spaces", collapsed: false, hosts: "combined", folded: [] });
  assert.deepEqual(viewSchema.parse({ folded: "bad" }).folded, []);
});

test("a folded project hides its tabs only in project order, and never a blocked or done tab", () => {
  const folded = new Set(groups.map(groupKey));
  const spaces = orderedEntries(groups, "spaces", null);
  assert.deepEqual(spaces.filter((entry) => !isHidden(entry, "spaces", folded)).map((entry) => entry.tab.id), ["b1"]);
  const priority = orderedEntries(groups, "priority", null);
  assert.equal(priority.filter((entry) => isHidden(entry, "priority", folded)).length, 0);
  const done: HostGroup[] = [{ ...groups[0]!, tabs: [tab("d1", "done"), tab("d2", "idle")] }];
  const doneEntries = orderedEntries(done, "spaces", null);
  assert.deepEqual(doneEntries.filter((entry) => !isHidden(entry, "spaces", folded)).map((entry) => entry.tab.id), ["d1"]);
});

test("fold all adds the projects of the list; unfold all keeps the folds of hosts without an answer", () => {
  const hosts = [
    { serverId: "mac", label: "Mac", error: null },
    { serverId: "pi", label: "Pi", error: "offline" },
  ];
  assert.deepEqual(foldAll(["pi/x", "mac/a"], groups, true, groups, hosts), ["pi/x", "mac/a", "mac/b"]);
  assert.deepEqual(foldAll(["pi/x", "mac/a", "mac/b"], groups, false, groups, hosts), ["pi/x"]);
  // A project that is gone from the Mac is dropped by both.
  assert.deepEqual(foldAll(["mac/gone"], groups, true, groups, hosts), ["mac/a", "mac/b"]);
  assert.deepEqual(foldAll(["mac/gone", "pi/x"], groups, false, groups, hosts), ["pi/x"]);
});

test("toggling a fold adds or removes it and drops folds of gone projects on hosts that answered", () => {
  const hosts = [
    { serverId: "mac", label: "Mac", error: null },
    { serverId: "pi", label: "Pi", error: "offline" },
  ];
  assert.deepEqual(toggleFolded([], "mac/a", groups, hosts), ["mac/a"]);
  assert.deepEqual(toggleFolded(["mac/a"], "mac/a", groups, hosts), []);
  // "mac/gone" is not on the Mac any more; the Pi did not answer, so "pi/x" stays.
  assert.deepEqual(toggleFolded(["mac/gone", "pi/x"], "mac/b", groups, hosts), ["pi/x", "mac/b"]);
});

test("the layout: a header for each project, folded projects keep only blocked rows", () => {
  const hosts = [{ serverId: "mac", label: "Mac", error: null }];
  // Beta's first tab is blocked: its header must still say folded (the v0.1.7 bug).
  const folded = new Set(["mac/b"]);
  const options = { sort: "spaces" as const, hostMode: "combined" as const, folded, activeKey: null };
  const layout = listLayout(groups, hosts, options);
  const items = layout.sections[0]!.items.map((item) => (item.kind === "header" ? `${item.group.workspaceId}:${item.folded ? "folded" : "open"}` : item.entry.tab.id));
  assert.deepEqual(items, ["a:open", "a1", "a2", "b:folded", "b1"]);
  assert.deepEqual(layout.rows.map((entry) => entry.tab.id), ["a1", "a2", "b1"]);
  assert.equal(layout.empty, false);
  assert.equal(layout.showHost, false);
});

test("the layout marks a folded project that holds the open tab, and ignores folds in state order", () => {
  const hosts = [{ serverId: "mac", label: "Mac", error: null }];
  const folded = new Set(["mac/b"]);
  const spaces = listLayout(groups, hosts, { sort: "spaces", hostMode: "combined", folded, activeKey: tabKey("mac", groups[1]!.tabs[1]!) });
  const header = spaces.sections[0]!.items.find((item) => item.kind === "header" && item.group.workspaceId === "b");
  assert.equal(header?.kind === "header" && header.holdsActive, true);
  const priority = listLayout(groups, hosts, { sort: "priority", hostMode: "combined", folded, activeKey: null });
  assert.deepEqual(priority.sections[0]!.items.map((item) => item.kind), ["row", "row", "row", "row"]);
});

test("the layout with a filter drops host sections without matching tabs and says when nothing matches", () => {
  const hosts = [
    { serverId: "mac", label: "Mac", error: null },
    { serverId: "pi", label: "Pi", error: null },
  ];
  const options = { sort: "spaces" as const, hostMode: "grouped" as const, folded: new Set<string>(), activeKey: null };
  assert.deepEqual(listLayout(groups, hosts, { ...options, filter: "blocked" }).sections.map((section) => section.host?.serverId), ["mac"]);
  assert.deepEqual(listLayout(groups, hosts, options).sections.map((section) => section.host?.serverId), ["mac", "pi"]);
  assert.equal(listLayout(groups, hosts, { ...options, filter: "unknown" }).empty, true);
});
