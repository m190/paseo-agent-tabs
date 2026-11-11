import { useHosts } from "@getpaseo/plugin/client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { errorMessage, withTimeout } from "../shared/async";
import { tabsRpc } from "../shared/tabs";
import { addSource, getSources, type HostSource, type Rpc, sourceChanged, sourceFor, subscribeSources, type TabsSnapshot } from "./hub";
import { combine, type Combined } from "./model";

export type { TabsSnapshot } from "./hub";

const POLL_MS = 2_000;
const TIMEOUT_MS = 8_000;

const EMPTY: TabsSnapshot = { serverId: null, groups: [], workspaces: [], error: null, loaded: false };

/** This copy's host: the app renders a copy's views, so they save settings on this host first. */
let own: HostSource | null = null;

export function ownSource(): HostSource | null {
  return own;
}

function setSnapshot(source: HostSource, next: TabsSnapshot, last: { text: string }): void {
  const text = JSON.stringify(next);
  if (text === last.text) return;
  last.text = text;
  source.snapshot = next;
  if (next.serverId) source.serverId = next.serverId;
  sourceChanged();
}

/**
 * Polls this copy's host and shares its list with the other copies. One poller for every view: it starts a
 * new request only after the previous one ended, so a request that never answers cannot pile up others;
 * after the timeout it reports the error and keeps the last list until the answer arrives. Returns the source
 * and the cleanup.
 */
export function startSource(rpc: Rpc): { source: HostSource; stop(): void } {
  let stopped = false;
  let pending: Promise<TabsSnapshot> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const last = { text: "" };
  const source: HostSource = { serverId: null, snapshot: EMPTY, rpc, pollNow: () => {} };

  const tick = async () => {
    try {
      pending ??= rpc(tabsRpc, {})
        .then((result) => {
          const snapshot = { ...result, loaded: true };
          // Also after the timeout: a slow host then still shows its list, and the answer clears the error.
          if (!stopped) setSnapshot(source, snapshot, last);
          return snapshot;
        })
        .finally(() => {
          pending = null;
        });
      await withTimeout(pending, TIMEOUT_MS, "The plugin server did not answer");
    } catch (error) {
      if (!stopped) setSnapshot(source, { ...source.snapshot, error: errorMessage(error), loaded: true }, last);
    }
    if (!stopped) timer = setTimeout(tick, POLL_MS);
  };
  source.pollNow = () => {
    if (stopped || pending) return;
    if (timer) clearTimeout(timer);
    void tick();
  };

  own = source;
  const remove = addSource(source);
  void tick();
  return {
    source,
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      remove();
      if (own === source) own = null;
    },
  };
}

function useSources(): readonly HostSource[] {
  return useSyncExternalStore(subscribeSources, getSources, getSources);
}

/** The tabs of all hosts with the plugin. */
export function useCombined(): Combined {
  const sources = useSources();
  const hosts = useHosts();
  return useMemo(() => combine(sources, hosts), [sources, hosts]);
}

/** The tabs of all hosts, outside React. Hosts show by server id. */
export function getCombined(): Combined {
  return combine(getSources(), []);
}

export { subscribeSources as subscribe };

/**
 * Resolves when the host's list contains the terminal, or after `timeoutMs`. A new tab opens only after
 * this, so the app already knows the terminal when the plugin asks it to show it.
 */
export function waitForTerminal(serverId: string, terminalId: string, timeoutMs = 3_000): Promise<void> {
  const present = () =>
    sourceFor(serverId)?.snapshot.groups.some((group) => group.tabs.some((tab) => tab.kind === "terminal" && tab.id === terminalId)) ?? false;
  if (present()) return Promise.resolve();
  sourceFor(serverId)?.pollNow();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    const unsubscribe = subscribeSources(() => {
      if (present()) done();
    });
  });
}

/** The current time, updated every `intervalMs`, for "3m ago" labels. */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
