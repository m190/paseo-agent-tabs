// Connection to this host's daemon with the host's own client packages.
// Adapted from better-paseo (MIT), server/tasks/provider-subagents.ts.
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { TerminalProfile } from "@getpaseo/protocol/messages";
import type * as TerminalProfiles from "@getpaseo/protocol/terminal-profiles";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export type HostDaemon = Pick<
  DaemonClient,
  | "close"
  | "listTerminals"
  | "fetchWorkspaces"
  | "fetchAgents"
  | "listProjects"
  | "captureTerminal"
  | "createTerminal"
  | "closeItems"
  | "getDaemonConfig"
  | "getLastServerInfoMessage"
>;
export type { TerminalProfile };

export type RawTerminal = Awaited<ReturnType<DaemonClient["listTerminals"]>>["terminals"][number];
export type RawWorkspace = Awaited<ReturnType<DaemonClient["fetchWorkspaces"]>>["entries"][number];
export type RawAgent = Awaited<ReturnType<DaemonClient["fetchAgents"]>>["entries"][number]["agent"];
export type RawProject = Awaited<ReturnType<DaemonClient["listProjects"]>>["projects"][number];
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
  const client: DaemonClient = new clientModule.DaemonClient({
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
