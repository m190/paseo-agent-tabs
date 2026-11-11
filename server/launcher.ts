import type { Profile } from "../shared/tabs";
import type { loadTerminalProfiles, TerminalProfile } from "./host-daemon";
import type { TabSource } from "./tab-source";

type ProfileRules = Awaited<ReturnType<typeof loadTerminalProfiles>>;

const CONFIG_TTL_MS = 10_000;

/** A plain terminal: the daemon starts the default shell when no command is given. */
const PLAIN_TERMINAL: Profile = { id: null, name: "Terminal", icon: "terminal", takesPrompt: false };

export interface CreatedTab {
  terminalId: string;
  workspaceId: string;
  name: string;
}

/** Opens new terminal tabs with the profiles from Paseo's settings (Claude Code, Codex, and others), and closes tabs. */
export class TabLauncher {
  private config: { profiles: readonly TerminalProfile[]; at: number } | null = null;

  constructor(
    private readonly source: TabSource,
    private readonly rules: () => Promise<ProfileRules>,
    private readonly now: () => number = Date.now,
  ) {}

  async profiles(): Promise<Profile[]> {
    const [profiles, rules] = await Promise.all([this.terminalProfiles(), this.rules()]);
    return [
      ...profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        icon: rules.getTerminalProfileIcon(profile) ?? null,
        takesPrompt: rules.profileTakesPrompt(profile),
      })),
      PLAIN_TERMINAL,
    ];
  }

  async create(workspaceId: string, profileId: string | null, prompt: string): Promise<CreatedTab> {
    const workspace = await this.source.workspace(workspaceId);
    if (!workspace) throw new Error(`Unknown workspace ${workspaceId}`);
    const cwd = workspace.workspaceDirectory || workspace.projectRootPath;
    const launch = profileId === null ? null : await this.launch(profileId, prompt);
    const created = await this.source.run("createTerminal", (daemon) =>
      daemon.createTerminal(cwd, launch?.name, undefined, {
        workspaceId,
        ...(launch ? { command: launch.command, args: launch.args } : {}),
      }),
    );
    if (!created.terminal) throw new Error(created.error ?? "The daemon did not create the terminal");
    this.source.refreshSoon();
    return { terminalId: created.terminal.id, workspaceId, name: created.terminal.name };
  }

  /** Closes a tab with the app's own call: the terminal stops, or the agent is archived. */
  async close(kind: "terminal" | "agent", id: string): Promise<{ closed: boolean }> {
    const result = await this.source.run("closeItems", (daemon) =>
      daemon.closeItems(kind === "terminal" ? { terminalIds: [id] } : { agentIds: [id] }),
    );
    const closed =
      kind === "terminal"
        ? result.terminals.some((terminal) => terminal.terminalId === id && terminal.success)
        : result.agents.some((agent) => agent.agentId === id);
    if (!closed) throw new Error(`The daemon did not close the ${kind}`);
    this.source.refreshSoon();
    return { closed };
  }

  private async launch(profileId: string, prompt: string): Promise<{ name: string; command: string; args: string[] }> {
    const [profiles, rules] = await Promise.all([this.terminalProfiles(), this.rules()]);
    const profile = profiles.find((candidate) => candidate.id === profileId);
    if (!profile) throw new Error(`Unknown terminal profile ${profileId}`);
    return rules.resolveTerminalProfileLaunch(profile, prompt.trim());
  }

  private async terminalProfiles(): Promise<readonly TerminalProfile[]> {
    if (this.config && this.now() - this.config.at < CONFIG_TTL_MS) return this.config.profiles;
    const [{ config }, rules] = await Promise.all([this.source.run("getDaemonConfig", (daemon) => daemon.getDaemonConfig()), this.rules()]);
    const profiles = rules.resolveTerminalProfiles(config.terminalProfiles);
    this.config = { profiles, at: this.now() };
    return profiles;
  }
}
