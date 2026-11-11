import { errorMessage, mapLimit, withTimeout } from "../shared/async";
import type { Tab, TabGroup, TabList, TabStatus, WorkspaceInfo } from "../shared/tabs";
import { type HostDaemon, type RawAgent, type RawProject, type RawTerminal, type RawWorkspace } from "./host-daemon";
import { trimPreview } from "./preview";
import { agentName, agentStatus, cleanTitle, FOOTER_LINES, terminalStatus } from "./status";

const CALL_TIMEOUT_MS = 5_000;
const LIST_CACHE_MS = 1_000;
const WORKSPACE_TTL_MS = 10_000;
const PAGE = 200;
const CAPTURE_CONCURRENCY = 4;
// Rows read above the preview: the input box and footer, and the empty rows below them in a tall terminal.
const CAPTURE_EXTRA_ROWS = 120;

interface Connection {
  generation: number;
  daemon: Promise<HostDaemon>;
}

interface Seen {
  status: TabStatus;
  since: number;
}

/**
 * The plugin server's view of the open tabs. One instance serves every client: list requests that arrive
 * together share one daemon round, and the result is reused for a short time.
 */
export class TabSource {
  private connection: Connection | null = null;
  private generation = 0;
  private workspaces = new Map<string, RawWorkspace>();
  /** Project id -> Paseo's color key of the project. */
  private colorKeys = new Map<string, string>();
  private workspacesAt = 0;
  private workspaceRefresh: Promise<void> | null = null;
  private seen = new Map<string, Seen>();
  private listing: Promise<TabList> | null = null;
  private last: { list: TabList; at: number } | null = null;
  private lastGood: TabList | null = null;

  constructor(
    private readonly connect: () => Promise<HostDaemon>,
    private readonly now: () => number = Date.now,
  ) {}

  list(): Promise<TabList> {
    if (this.last && this.now() - this.last.at < LIST_CACHE_MS) return Promise.resolve(this.last.list);
    this.listing ??= this.load().finally(() => {
      this.listing = null;
    });
    return this.listing;
  }

  async previews(terminalIds: readonly string[], lines: number): Promise<{ previews: Record<string, string[]> }> {
    const previews: Record<string, string[]> = {};
    const { generation, daemon } = await this.daemon();
    const results = await mapLimit(terminalIds, CAPTURE_CONCURRENCY, (id) =>
      this.call(daemon.captureTerminal(id, { start: -(lines + CAPTURE_EXTRA_ROWS), stripAnsi: true }), "capture").then(
        (capture) => ({ id, lines: trimPreview(capture.lines, lines) }),
        () => null,
      ),
    );
    if (terminalIds.length > 0 && results.every((result) => result === null)) this.invalidate(generation);
    for (const result of results) if (result) previews[result.id] = result.lines;
    return { previews };
  }

  /** Runs one daemon call on the shared connection, with the time limit, and drops the connection on failure. */
  async run<T>(name: string, call: (daemon: HostDaemon) => Promise<T>): Promise<T> {
    const { generation, daemon } = await this.daemon();
    try {
      return await this.call(call(daemon), name);
    } catch (error) {
      this.invalidate(generation);
      throw error;
    }
  }

  /** A workspace by id, refreshed from the daemon when it is not known yet. */
  async workspace(workspaceId: string): Promise<RawWorkspace | null> {
    if (!this.workspaces.has(workspaceId)) {
      const { daemon } = await this.daemon();
      this.workspacesAt = 0;
      await this.ensureWorkspaces(daemon, []);
    }
    return this.workspaces.get(workspaceId) ?? null;
  }

  /** The next list request reads the daemon again, for example after a new tab. */
  refreshSoon(): void {
    this.last = null;
  }

  async dispose(): Promise<void> {
    const current = this.connection;
    this.connection = null;
    await closeQuietly(current);
  }

  private async load(): Promise<TabList> {
    let generation = -1;
    try {
      const connection = await this.daemon();
      generation = connection.generation;
      const daemon = connection.daemon;
      const [{ terminals }, agents] = await Promise.all([
        this.call(daemon.listTerminals(), "listTerminals"),
        this.openAgents(daemon),
      ]);
      const terminalTabs = await mapLimit(
        terminals.filter((terminal) => terminal.workspaceId),
        CAPTURE_CONCURRENCY,
        (terminal) => this.terminalTab(daemon, terminal),
      );
      const tabs = [...terminalTabs, ...agents.map((agent) => this.agentTab(agent))];
      this.forgetClosed(tabs);
      await this.ensureWorkspaces(daemon, tabs);
      // The client sorts lists by host, and drops a list without one; so this is an error the user must see.
      const serverId = daemon.getLastServerInfoMessage()?.serverId;
      if (!serverId) throw new Error("The daemon did not report its host id (Paseo version not supported?)");
      const list: TabList = {
        serverId,
        groups: groupTabs(tabs, (id) => this.info(id)),
        workspaces: sortWorkspaces([...this.workspaces.keys()].map((id) => this.info(id))),
        error: null,
      };
      this.lastGood = list;
      this.last = { list, at: this.now() };
      return list;
    } catch (error) {
      if (generation >= 0) this.invalidate(generation);
      // Keep the last good list, so a short outage does not empty the sidebar.
      return {
        serverId: this.lastGood?.serverId ?? null,
        groups: this.lastGood?.groups ?? [],
        workspaces: this.lastGood?.workspaces ?? [],
        error: errorMessage(error),
      };
    }
  }

  private daemon(): Promise<{ generation: number; daemon: HostDaemon }> {
    if (!this.connection) {
      const generation = ++this.generation;
      const daemon = this.connect();
      this.connection = { generation, daemon };
      daemon.catch(() => this.invalidate(generation));
    }
    const { generation, daemon } = this.connection;
    return daemon.then((client) => ({ generation, daemon: client }));
  }

  /** Drops a broken connection, but only the one the failed request used. */
  private invalidate(generation: number): void {
    if (this.connection?.generation !== generation) return;
    const current = this.connection;
    this.connection = null;
    void closeQuietly(current);
  }

  private call<T>(promise: Promise<T>, name: string): Promise<T> {
    return withTimeout(promise, CALL_TIMEOUT_MS, `The daemon did not answer ${name}`);
  }

  private async openAgents(daemon: HostDaemon): Promise<RawAgent[]> {
    const agents: RawAgent[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.call(daemon.fetchAgents({ page: { limit: PAGE, ...(cursor ? { cursor } : {}) } }), "fetchAgents");
      for (const { agent } of page.entries) {
        if (!agent.archivedAt && agent.status !== "closed" && agent.workspaceId) agents.push(agent);
      }
      cursor = page.pageInfo?.nextCursor ?? undefined;
    } while (cursor);
    return agents;
  }

  private async ensureWorkspaces(daemon: HostDaemon, tabs: readonly Tab[]): Promise<void> {
    const unknown = tabs.some((tab) => !this.workspaces.has(tab.workspaceId));
    if (!unknown && this.now() - this.workspacesAt <= WORKSPACE_TTL_MS) return;
    this.workspaceRefresh ??= this.refreshWorkspaces(daemon).finally(() => {
      this.workspaceRefresh = null;
    });
    await this.workspaceRefresh;
  }

  private async refreshWorkspaces(daemon: HostDaemon): Promise<void> {
    const next = new Map<string, RawWorkspace>();
    let cursor: string | undefined;
    do {
      const page = await this.call(daemon.fetchWorkspaces({ page: { limit: PAGE, ...(cursor ? { cursor } : {}) } }), "fetchWorkspaces");
      for (const workspace of page.entries) next.set(workspace.id, workspace);
      cursor = page.pageInfo?.nextCursor ?? undefined;
    } while (cursor);
    const { projects } = await this.call(daemon.listProjects(), "listProjects");
    this.workspaces = next;
    this.colorKeys = colorKeys(projects, daemon.getLastServerInfoMessage()?.serverId ?? "");
    this.workspacesAt = this.now();
  }

  private info(workspaceId: string): WorkspaceInfo {
    const workspace = this.workspaces.get(workspaceId);
    return workspaceInfo(workspaceId, workspace, workspace ? this.colorKeys.get(workspace.projectId) : undefined);
  }

  private async terminalTab(daemon: HostDaemon, terminal: RawTerminal): Promise<Tab> {
    const agent = agentName(terminal.name);
    const rows = FOOTER_LINES[agent];
    const footer = rows ? await this.footer(daemon, terminal.id, rows) : null;
    const { status, detail } = terminalStatus({ name: terminal.name, title: terminal.title, activity: terminal.activity, footer });
    return {
      id: terminal.id,
      kind: "terminal",
      workspaceId: terminal.workspaceId!,
      title: cleanTitle(terminal.title, terminal.name),
      agent,
      status,
      detail,
      statusSince: this.since(`terminal:${terminal.id}`, status, terminal.activity?.changedAt),
    };
  }

  private agentTab(agent: RawAgent): Tab {
    const status = agentStatus(agent);
    const updated = Date.parse(agent.updatedAt);
    return {
      id: agent.id,
      kind: "agent",
      workspaceId: agent.workspaceId!,
      title: cleanTitle(agent.title, "Agent"),
      agent: agent.provider ? agentName(agent.provider) : "agent",
      status,
      detail: null,
      statusSince: this.since(`agent:${agent.id}`, status, Number.isFinite(updated) ? updated : undefined),
    };
  }

  /** The last `rows` non-empty rows of the screen, joined. */
  private async footer(daemon: HostDaemon, terminalId: string, rows: number): Promise<string | null> {
    try {
      const capture = await this.call(daemon.captureTerminal(terminalId, { start: -CAPTURE_EXTRA_ROWS, stripAnsi: true }), "capture");
      return capture.lines.filter((line) => line.trim() !== "").slice(-rows).join(" ");
    } catch {
      return null;
    }
  }

  /**
   * When the tab entered its current status. The first time the plugin sees a tab, the daemon's own time is
   * the best guess; after that, a status change starts a new time.
   */
  private since(key: string, status: TabStatus, reported: number | undefined): number {
    const previous = this.seen.get(key);
    if (previous?.status === status) return previous.since;
    const since = previous ? this.now() : (reported ?? this.now());
    this.seen.set(key, { status, since });
    return since;
  }

  private forgetClosed(tabs: readonly Tab[]): void {
    const open = new Set(tabs.map((tab) => `${tab.kind}:${tab.id}`));
    for (const key of this.seen.keys()) if (!open.has(key)) this.seen.delete(key);
  }
}

async function closeQuietly(connection: Connection | null): Promise<void> {
  if (!connection) return;
  const daemon = await connection.daemon.catch(() => null);
  await daemon?.close().catch(() => {});
}

/**
 * Paseo's color key for each project, as its own project list computes it: the project key when only one
 * project on this host has it, otherwise the host and project ids.
 */
export function colorKeys(projects: readonly Pick<RawProject, "projectId" | "projectKey">[], serverId: string): Map<string, string> {
  const counts = new Map<string, number>();
  for (const { projectKey } of projects) if (projectKey) counts.set(projectKey, (counts.get(projectKey) ?? 0) + 1);
  return new Map(
    projects.map(({ projectId, projectKey }) => [
      projectId,
      projectKey && counts.get(projectKey) === 1 ? projectKey : JSON.stringify([serverId, projectId]),
    ]),
  );
}

/** The names and the color key the UI shows for a workspace. */
export function workspaceInfo(workspaceId: string, workspace: RawWorkspace | undefined, colorKey?: string): WorkspaceInfo {
  const isMain = !workspace || workspace.workspaceKind === "local_checkout" || workspace.workspaceKind === "directory";
  return {
    workspaceId,
    projectName: workspace?.projectCustomName || workspace?.projectDisplayName || workspaceId,
    colorKey: colorKey ?? workspace?.projectId ?? workspaceId,
    workspaceName: isMain ? null : workspace.title || workspace.name,
  };
}

/** By project, then by worktree; the main checkout first. */
export function sortWorkspaces<T extends WorkspaceInfo>(items: T[]): T[] {
  return items.sort(
    (a, b) => a.projectName.localeCompare(b.projectName) || (a.workspaceName ?? "").localeCompare(b.workspaceName ?? ""),
  );
}

/** Tabs by workspace, in workspace order. */
export function groupTabs(tabs: readonly Tab[], info: (workspaceId: string) => WorkspaceInfo): TabGroup[] {
  const groups = new Map<string, TabGroup>();
  for (const tab of tabs) {
    let group = groups.get(tab.workspaceId);
    if (!group) {
      group = { ...info(tab.workspaceId), tabs: [] };
      groups.set(tab.workspaceId, group);
    }
    group.tabs.push(tab);
  }
  return sortWorkspaces([...groups.values()]);
}
