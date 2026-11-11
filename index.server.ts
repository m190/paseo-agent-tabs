import type { PluginServerContext } from "@getpaseo/plugin/server";
import { connectHostDaemon, loadTerminalProfiles } from "./server/host-daemon";
import { TabLauncher } from "./server/launcher";
import { TabSource } from "./server/tab-source";
import { closeTabRpc, createTabRpc, previewRpc, profilesRpc, tabsRpc } from "./shared/tabs";
import { VIEW_SETTINGS } from "./shared/view-settings";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(VIEW_SETTINGS);
  const source = new TabSource(connectHostDaemon);
  const launcher = new TabLauncher(source, loadTerminalProfiles);
  server.handle(tabsRpc, () => source.list());
  server.handle(previewRpc, ({ terminalIds, lines }) => source.previews(terminalIds, lines));
  server.handle(profilesRpc, async () => ({ profiles: await launcher.profiles() }));
  server.handle(createTabRpc, ({ workspaceId, profileId, prompt }) => launcher.create(workspaceId, profileId, prompt));
  server.handle(closeTabRpc, ({ kind, id }) => launcher.close(kind, id));
  return () => {
    void source.dispose();
  };
}
