// Pure functions over the tab list: identity, counts, order. No React and no styling.
import type { Tab, TabGroup, TabList, TabStatus, WorkspaceInfo } from "../shared/tabs";
import type { View } from "../shared/view-settings";

/** herdr's priority order: blocked first. */
export const PRIORITY: readonly TabStatus[] = ["blocked", "done", "working", "idle", "unknown"];

/** The states that the summaries count separately. */
export const ATTENTION: readonly TabStatus[] = ["blocked", "done", "working"];

export type SortMode = View["sort"];
export type HostMode = View["hosts"];
export type Counts = Record<TabStatus, number>;

/** A Paseo host (computer) with the plugin. */
export interface HostInfo {
  serverId: string;
  label: string;
  error: string | null;
}

/** A workspace with the host it belongs to. */
export interface HostWorkspace extends WorkspaceInfo {
  serverId: string;
  hostLabel: string;
}

export interface HostGroup extends TabGroup {
  serverId: string;
  hostLabel: string;
}

/** The lists of all hosts as one. */
export interface Combined {
  hosts: HostInfo[];
  groups: HostGroup[];
  workspaces: HostWorkspace[];
  /** The errors of the hosts that did not answer, with the host name when there are several hosts. */
  error: string | null;
  /** False until the first host answered. */
  loaded: boolean;
}

export interface TabEntry {
  tab: Tab;
  group: HostGroup;
}

/** A tab with its host: a new tab, or a workspace to start one in. */
export interface WorkspaceTarget {
  serverId: string;
  workspaceId: string;
}

/** A React key for a new-tab menu: a new target starts a new menu, so it does not keep the old project. */
export function targetKey(target?: WorkspaceTarget): string {
  return target ? `${target.serverId}/${target.workspaceId}` : "pick";
}

export function tabKey(serverId: string, tab: Pick<Tab, "kind" | "id">): string {
  return `${serverId}/${tab.kind}:${tab.id}`;
}

export function entryKey(entry: TabEntry): string {
  return tabKey(entry.group.serverId, entry.tab);
}

export interface SourceList {
  serverId: string | null;
  snapshot: TabList & { loaded: boolean };
}

/**
 * Joins the lists of all hosts, in the order of the app's host list. A host without an answer yet has no
 * server id and only counts for `loaded` and `error`. When two copies report one host, the last one wins.
 */
export function combine(sources: readonly SourceList[], appHosts: readonly { serverId: string; label: string }[]): Combined {
  const byServer = new Map<string, SourceList>();
  for (const source of sources) if (source.serverId) byServer.set(source.serverId, source);
  const order = [...appHosts.map((host) => host.serverId).filter((id) => byServer.has(id))];
  for (const id of byServer.keys()) if (!order.includes(id)) order.push(id);
  const label = (id: string) => appHosts.find((host) => host.serverId === id)?.label ?? id;

  const hosts: HostInfo[] = order.map((serverId) => ({ serverId, label: label(serverId), error: byServer.get(serverId)!.snapshot.error }));
  const groups: HostGroup[] = [];
  const workspaces: HostWorkspace[] = [];
  for (const host of hosts) {
    const { snapshot } = byServer.get(host.serverId)!;
    for (const group of snapshot.groups) groups.push({ ...group, serverId: host.serverId, hostLabel: host.label });
    for (const workspace of snapshot.workspaces) workspaces.push({ ...workspace, serverId: host.serverId, hostLabel: host.label });
  }
  const many = hosts.length > 1;
  const errors = [
    ...hosts.filter((host) => host.error).map((host) => (many ? `${host.label}: ${host.error}` : host.error!)),
    ...sources.filter((source) => !source.serverId && source.snapshot.error).map((source) => source.snapshot.error!),
  ];
  return {
    hosts,
    groups,
    workspaces,
    error: errors.length > 0 ? errors.join(" · ") : null,
    loaded: sources.length === 0 || sources.some((source) => source.snapshot.loaded),
  };
}

export function groupLabel(group: WorkspaceInfo): string {
  return group.workspaceName ? `${group.projectName} · ${group.workspaceName}` : group.projectName;
}

/** A plain shell has no agent state: the UI shows it as a terminal, not as "unknown". */
export function isShell(tab: Tab): boolean {
  return tab.agent === "shell" && tab.status === "unknown";
}

export function allTabs(groups: readonly TabGroup[]): Tab[] {
  return groups.flatMap((group) => group.tabs);
}

export function countByStatus(groups: readonly TabGroup[]): Counts {
  const counts: Counts = { blocked: 0, working: 0, done: 0, idle: 0, unknown: 0 };
  for (const tab of allTabs(groups)) counts[tab.status] += 1;
  return counts;
}

/** Counts for the state filters: a plain shell has no agent state, so it does not count as "unknown". */
export function agentCounts(groups: readonly TabGroup[]): Counts {
  return countByStatus(groups.map((group) => ({ ...group, tabs: group.tabs.filter((tab) => !isShell(tab)) })));
}

export function total(counts: Counts): number {
  return PRIORITY.reduce((sum, status) => sum + counts[status], 0);
}

/** The most urgent status, as herdr rolls a blocked agent up to its workspace. */
export function rollup(tabs: readonly Tab[]): TabStatus {
  const present = new Set(tabs.map((tab) => tab.status));
  return PRIORITY.find((status) => present.has(status)) ?? "unknown";
}

/** Tabs in display order: by workspace, or by priority and then the most recent status change. */
export function orderedEntries(groups: readonly HostGroup[], sort: SortMode, filter: TabStatus | null): TabEntry[] {
  const entries = groups.flatMap((group) => group.tabs.map((tab) => ({ tab, group })));
  const filtered = filter ? entries.filter((entry) => entry.tab.status === filter) : entries;
  if (sort === "spaces") return filtered;
  return [...filtered].sort(
    (a, b) => PRIORITY.indexOf(a.tab.status) - PRIORITY.indexOf(b.tab.status) || b.tab.statusSince - a.tab.statusSince,
  );
}

/** True for the first entry of each workspace when the list is grouped. */
export function startsGroup(entries: readonly TabEntry[], index: number, sort: SortMode): boolean {
  return sort === "spaces" && (index === 0 || entries[index - 1]!.group !== entries[index]!.group);
}

/** The key of a workspace group in the "folded" view setting. */
export function groupKey(group: WorkspaceTarget): string {
  return `${group.serverId}/${group.workspaceId}`;
}

/** True when the group's project is folded: in "spaces" order it shows a header with its state counts. */
export function isGroupFolded(group: WorkspaceTarget, sort: SortMode, folded: ReadonlySet<string>): boolean {
  return sort === "spaces" && folded.has(groupKey(group));
}

/** True when a folded project hides the entry. A blocked tab stays: it waits for you. */
export function isHidden(entry: TabEntry, sort: SortMode, folded: ReadonlySet<string>): boolean {
  return entry.tab.status !== "blocked" && isGroupFolded(entry.group, sort, folded);
}

/** Folds or unfolds all projects in the list. Folds of hosts without an answer stay as they are. */
export function foldAll(folded: readonly string[], groups: readonly WorkspaceTarget[], fold: boolean): string[] {
  const keys = groups.map(groupKey);
  if (!fold) return folded.filter((key) => !keys.includes(key));
  return [...folded, ...keys.filter((key) => !folded.includes(key))];
}

/**
 * Folds or unfolds one project. It also drops the keys of projects that are gone from a host that answered,
 * so the setting does not grow; a host without an answer keeps its keys.
 */
export function toggleFolded(folded: readonly string[], key: string, known: readonly WorkspaceTarget[], hosts: readonly HostInfo[]): string[] {
  const live = new Set(known.map(groupKey));
  const answered = new Set(hosts.filter((host) => !host.error).map((host) => host.serverId));
  const kept = folded.filter((item) => item !== key && (live.has(item) || !answered.has(item.slice(0, item.indexOf("/")))));
  return folded.includes(key) ? kept : [...kept, key];
}

export interface HostSection {
  /** Null when the list is not split by host. */
  host: HostInfo | null;
  entries: TabEntry[];
}

/** Splits the entries by host, when there are several hosts and the mode is "grouped". A host without tabs keeps its section. */
export function hostSections(entries: readonly TabEntry[], hosts: readonly HostInfo[], mode: HostMode): HostSection[] {
  if (mode !== "grouped" || hosts.length < 2) return [{ host: null, entries: [...entries] }];
  return hosts.map((host) => ({ host, entries: entries.filter((entry) => entry.group.serverId === host.serverId) }));
}

export function formatAge(since: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - since) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
