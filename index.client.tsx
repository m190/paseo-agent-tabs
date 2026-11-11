import type { PluginClientContext } from "@getpaseo/plugin/client";
import { watchActiveTab } from "./client/active-tab";
import { BoardScreen } from "./client/board";
import { syncHeaderButtons } from "./client/header-buttons";
import { prepareNavigation } from "./client/navigation";
import { startSource } from "./client/store";
import { AgentsPanel, AgentsSidebar, BOARD_SCREEN_ID, setBoardOpener } from "./client/ui";

/**
 * Registers one part of the plugin. An older app may lack a registration function; then only that part
 * is missing, and the other parts still load.
 */
function optional(name: string, register: () => () => void): () => void {
  try {
    return register();
  } catch (error) {
    console.warn(`[agent-tabs] ${name} is not available in this app version`, error);
    return () => {};
  }
}

export default function contribute(client: PluginClientContext) {
  setBoardOpener(() => client.openScreen({ screenId: BOARD_SCREEN_ID }));
  prepareNavigation();

  // This copy polls its own host; the views show the tabs of every host's copy (see client/hub.ts).
  const { source, stop } = startSource(client.rpc.bind(client));
  const cleanups = [
    stop,
    watchActiveTab(),
    optional("Board screen", () => client.addScreen({ id: BOARD_SCREEN_ID, title: "Agents", Component: BoardScreen })),
    optional("Sidebar list", () => client.addSidebarHeaderItem({ id: "agents", title: "Agents", Component: AgentsSidebar })),
    optional("Right panel", () =>
      client.addWorkspacePanel({ id: "agents", title: "Agents", icon: "Bot", locations: ["explorer"], Component: AgentsPanel }),
    ),
    optional("Command Center item", () =>
      client.addCommandCenterItem({
        id: "agents-board",
        title: "Open agents board",
        keywords: ["agents", "tabs", "herdr", "board"],
        icon: "LayoutGrid",
        context: "global",
        onSelect: ({ openScreen }) => openScreen({ screenId: BOARD_SCREEN_ID }),
      }),
    ),
    optional("Header buttons", () => syncHeaderButtons(client, source)),
  ];

  return () => {
    for (const cleanup of cleanups.reverse()) cleanup();
    setBoardOpener(() => {});
  };
}
