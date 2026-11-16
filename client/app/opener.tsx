import * as kit from "@getpaseo/plugin/client";
import type { AgentRef } from "@getpaseo/plugin/client";
import { Component, type ReactNode, useCallback, useEffect, useMemo } from "react";
import type { Tab } from "../../shared/tabs";
import { addTabOpener } from "../hub";

// The app's own functions for plugins to open a tab. They work in the browser, in the desktop app and in the
// native app, and they select the tab before the app shows the workspace (see navigation.ts). Each element
// here gives one function to the plugin while it is on screen.
//
// One rule: an opener opens only a tab that is in the app's own list (Paseo 0.16 and later). The app knows a
// tab by a reference from that list, and it keeps an agent tab open only when the list has the agent. For
// other tabs, and in an older app, the plugin uses its other ways.

type Kit = Pick<typeof kit, "usePaseo" | "useTerminals" | "useAgents" | "useHosts">;
const { usePaseo, useTerminals, useAgents, useHosts } = kit as Partial<Kit>;

/** Opens the tabs of one kind that are in the app's list `refs`. */
function useOpener<Ref extends { hostId: string; id: string }>(kind: Tab["kind"], refs: readonly Ref[], open: (ref: Ref) => void): void {
  useEffect(
    () =>
      addTabOpener((serverId, tab) => {
        const ref = tab.kind === kind ? refs.find((item) => item.hostId === serverId && item.id === tab.id) : undefined;
        if (!ref) return false;
        open(ref);
        return true;
      }),
    [kind, refs, open],
  );
}

/** The terminal tabs of one host. The list hook throws while the host cannot list its terminals. */
function TerminalOpener({ serverId }: { serverId: string }) {
  const paseo = usePaseo!();
  const terminals = useTerminals!(useMemo(() => ({ hosts: [serverId] }), [serverId]));
  useOpener(
    "terminal",
    terminals,
    useCallback((ref) => paseo.terminals.ref(ref).focus(), [paseo]),
  );
  return null;
}

/** One opener for each online host, so a host with an error does not stop the others. A host that connects again gets a new one. */
function TerminalOpeners() {
  const online = useHosts!().filter((host) => host.status === "online");
  return online.map((host) => (
    <Quiet key={host.serverId}>
      <TerminalOpener serverId={host.serverId} />
    </Quiet>
  ));
}

/** The agent tabs. */
function AgentOpener({ open }: { open(ref: AgentRef): void }) {
  useOpener("agent", useAgents!(), open);
  return null;
}

/** Shows nothing after an error of its children: the plugin then opens these tabs with its other ways. */
class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** The app gives a view one of these functions for an agent tab, or none. */
export interface OpenerProps {
  /** `navigation.openAgent` of a sidebar view. */
  openAgentRef?(ref: AgentRef): void;
  /** `navigation.openAgent` of a screen or a panel. */
  openAgentId?(input: { agentId: string; serverId: string }): void;
}

/** Empty elements that give the plugin the app's own functions to open a tab, while they are on screen. */
export function Openers({ openAgentRef, openAgentId }: OpenerProps) {
  const openAgent = useMemo(
    () => openAgentRef ?? (openAgentId && ((ref: AgentRef) => openAgentId({ agentId: ref.id, serverId: ref.hostId }))),
    [openAgentRef, openAgentId],
  );
  const hooks = (...names: (keyof Kit)[]) => names.every((name) => typeof (kit as Partial<Kit>)[name] === "function");
  return (
    <>
      {openAgent && hooks("useAgents") && (
        <Quiet>
          <AgentOpener open={openAgent} />
        </Quiet>
      )}
      {hooks("usePaseo", "useTerminals", "useHosts") && <TerminalOpeners />}
    </>
  );
}
