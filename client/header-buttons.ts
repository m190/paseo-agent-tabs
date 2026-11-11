import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import type { HostSource } from "./hub";
import { subscribe } from "./store";
import { AgentsPopover, AgentsSummaryIcon } from "./ui";

/** Plugin button ids must match /^[a-z][a-z0-9-]*$/. */
function buttonId(workspaceId: string): string {
  return `tabs-${workspaceId.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
}

/**
 * Keeps one header button in every workspace of this copy's host, also in workspaces without tabs. A header
 * button needs a workspace id, so the set follows the host's workspace list. Returns the cleanup.
 */
export function syncHeaderButtons(client: PluginClientContext, source: HostSource): () => void {
  const buttons = new Map<string, PluginButtonRegistration>();

  const sync = () => {
    const { groups, workspaces, error } = source.snapshot;
    // Without a workspace list (daemon not reachable yet), keep the buttons as they are.
    if (error && workspaces.length === 0) return;
    const wanted = new Set([...workspaces, ...groups].map((workspace) => workspace.workspaceId));
    for (const [workspaceId, button] of buttons) {
      if (wanted.has(workspaceId)) continue;
      button.remove();
      buttons.delete(workspaceId);
    }
    for (const workspaceId of wanted) {
      if (buttons.has(workspaceId)) continue;
      try {
        buttons.set(
          workspaceId,
          client.addHeaderButton({
            id: buttonId(workspaceId),
            workspaceId,
            // The app shows the title above the list on phones; the list's own header has the counts.
            button: { title: "Agents", icon: AgentsSummaryIcon, behavior: { kind: "popover", Content: AgentsPopover } },
          }),
        );
      } catch (error) {
        console.error("[agent-tabs] Could not add header button", workspaceId, error);
      }
    }
  };

  const unsubscribe = subscribe(sync);
  sync();
  return () => {
    unsubscribe();
    for (const button of buttons.values()) button.remove();
    buttons.clear();
  };
}
