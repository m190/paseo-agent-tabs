import { errorMessage, withTimeout } from "../shared/async";
import { closeTabRpc, type Tab } from "../shared/tabs";
import { getActive, setActive, sourceFor } from "./hub";

const CLOSE_TIMEOUT_MS = 10_000;

export { errorMessage };

/** Closes a tab on its host, as the app's own close does: the terminal stops, or the agent is archived. */
export async function closeTab(serverId: string, tab: Tab): Promise<void> {
  const source = sourceFor(serverId);
  if (!source) throw new Error("This host is not connected");
  await withTimeout(source.rpc(closeTabRpc, { kind: tab.kind, id: tab.id }), CLOSE_TIMEOUT_MS, "The host did not answer");
  const active = getActive();
  if (active?.serverId === serverId && active.tab.kind === tab.kind && active.tab.id === tab.id) setActive(null);
  source.pollNow();
}
