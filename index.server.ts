import type { PluginServerContext } from "@getpaseo/plugin/server";
import { connectHostDaemon, loadTerminalProfiles } from "./server/host-daemon";
import { TabLauncher } from "./server/launcher";
import { TabSource } from "./server/tab-source";
import { closeTabRpc, createTabRpc, previewRpc, profilesRpc, tabsRpc } from "./shared/tabs";
import { VIEW_SETTINGS } from "./shared/view-settings";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(VIEW_SETTINGS);
  // The source finds the agent of a renamed profile through the launcher's cached profile list. The
  // launcher is created next; the source calls it only when a list is requested.
  const source: TabSource = new TabSource(connectHostDaemon, Date.now, () => launcher.terminalProfiles());
  const launcher: TabLauncher = new TabLauncher(source, loadTerminalProfiles);
  server.handle(tabsRpc, () => source.list());
  server.handle(previewRpc, ({ terminalIds, lines }) => source.previews(terminalIds, lines));
  server.handle(profilesRpc, async () => ({ profiles: await launcher.profiles() }));
  server.handle(createTabRpc, ({ workspaceId, profileId, prompt }) => launcher.create(workspaceId, profileId, prompt));
  server.handle(closeTabRpc, ({ kind, id }) => launcher.close(kind, id));
  return () => {
    void source.dispose();
  };
}
