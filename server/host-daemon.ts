// Connection to this host's daemon with the host's own client packages.
// Adapted from better-paseo (MIT), server/tasks/provider-subagents.ts.
import type {
  CaptureTerminalResponse,
  CloseItemsResponse,
  CreateTerminalResponse,
  ListTerminalsResponse,
  MutableDaemonConfig,
  ServerInfoStatusPayload,
  SessionInboundMessage,
  SessionOutboundMessage,
  TerminalProfile,
} from "@getpaseo/protocol/messages";
import type * as TerminalProfiles from "@getpaseo/protocol/terminal-profiles";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// The part of the host's internal DaemonClient (@getpaseo/client/internal/daemon-client) that this plugin calls,
// copied from its 0.15 declarations. Paseo cannot resolve that package when it builds a plugin from Git.
type Outbound<T extends SessionOutboundMessage["type"]> = Extract<SessionOutboundMessage, { type: T }> extends { payload: infer P } ? P : never;
type Request<T extends SessionInboundMessage["type"]> = Omit<Extract<SessionInboundMessage, { type: T }>, "type" | "requestId">;

export interface HostDaemon {
  close(): Promise<void>;
  listTerminals(cwd?: string, requestId?: string, options?: { workspaceId?: string }): Promise<ListTerminalsResponse["payload"]>;
  fetchWorkspaces(options?: Request<"fetch_workspaces_request">): Promise<Outbound<"fetch_workspaces_response">>;
  fetchAgents(options?: Request<"fetch_agents_request">): Promise<Outbound<"fetch_agents_response">>;
  listProjects(options?: Request<"project.list.request">): Promise<Outbound<"project.list.response">>;
  captureTerminal(
    terminalId: string,
    options?: { start?: number; end?: number; stripAnsi?: boolean },
    requestId?: string,
  ): Promise<CaptureTerminalResponse["payload"]>;
  createTerminal(
    cwd: string,
    name?: string,
    requestId?: string,
    options?: { agentId?: string; command?: string; args?: string[]; workspaceId?: string; size?: { rows: number; cols: number } },
  ): Promise<CreateTerminalResponse["payload"]>;
  closeItems(input: { agentIds?: string[]; terminalIds?: string[] }, requestId?: string): Promise<CloseItemsResponse["payload"]>;
  getDaemonConfig(requestId?: string): Promise<{ requestId: string; config: MutableDaemonConfig }>;
  getLastServerInfoMessage(): ServerInfoStatusPayload | null;
}
export type { TerminalProfile };

export type RawTerminal = Awaited<ReturnType<HostDaemon["listTerminals"]>>["terminals"][number];
export type RawWorkspace = Awaited<ReturnType<HostDaemon["fetchWorkspaces"]>>["entries"][number];
export type RawAgent = Awaited<ReturnType<HostDaemon["fetchAgents"]>>["entries"][number]["agent"];
export type RawProject = Awaited<ReturnType<HostDaemon["listProjects"]>>["projects"][number];
export type TerminalActivity = NonNullable<RawTerminal["activity"]>;

/**
 * Loads a module from the Paseo installation that runs this plugin, so the plugin speaks the daemon's own
 * protocol version. The plugin process starts from the host's `plugin-process.js`.
 */
function hostModule<T>(id: string): Promise<T> {
  const entry = process.argv[1];
  if (!entry) return Promise.reject(new Error("Plugin process has no entry path"));
  return import(pathToFileURL(createRequire(entry).resolve(id)).href) as Promise<T>;
}

/** Paseo's own rules for terminal profiles: the default list and the prompt substitution. */
export function loadTerminalProfiles(): Promise<typeof TerminalProfiles> {
  return hostModule("@getpaseo/protocol/terminal-profiles");
}

export async function connectHostDaemon(): Promise<HostDaemon> {
  // These modules have no public types for this use; the plugin calls only what it needs.
  const [clientModule, control, ws] = await Promise.all([
    hostModule<any>("@getpaseo/client/internal/daemon-client"),
    hostModule<any>("@getpaseo/server/daemon-control"),
    hostModule<any>("ws"),
  ]);
  const home: string = process.env.PASEO_HOME || control.resolvePaseoHome(process.env);
  const listen = (await control.readDaemonInstance(home))?.listen;
  if (typeof listen !== "string" || !listen.trim()) throw new Error("Daemon listen address is unknown");
  const target = socketTarget(listen.trim());
  if (!target) throw new Error(`Unsupported daemon listen address: ${listen}`);
  const WebSocket = ws.default ?? ws.WebSocket;
  const client: HostDaemon & { connect(): Promise<void> } = new clientModule.DaemonClient({
    url: target.url,
    clientId: "cid_agent_tabs",
    clientType: "cli",
    localCredential: () => control.readLocalCredentialForTarget(home, listen) ?? undefined,
    connectTimeoutMs: 10_000,
    webSocketFactory: (url: string, config?: { headers?: Record<string, string>; protocols?: string | string[] }) =>
      new WebSocket(url, config?.protocols, {
        headers: config?.headers,
        ...(target.socketPath ? { socketPath: target.socketPath } : {}),
      }),
    // The tab source opens a new connection after a failure.
    reconnect: { enabled: false },
  });
  await client.connect();
  return client;
}

function socketTarget(listen: string): { url: string; socketPath?: string } | null {
  if (listen.startsWith("unix://") || listen.startsWith("/")) {
    const socketPath = listen.replace(/^unix:\/\//, "");
    return { url: `ws+unix://${socketPath}:/ws`, socketPath };
  }
  if (/^[^/\s]+:\d+$/.test(listen)) return { url: `ws://${listen}/ws` };
  return null;
}
