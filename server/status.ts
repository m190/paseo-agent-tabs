// Every rule that decides a tab's status, in one place and in order of precedence.
// The inputs are what the daemon and the agent's own screen show; nothing here has side effects.
import type { TabStatus } from "../shared/tabs";
import type { RawAgent, TerminalActivity } from "./host-daemon";

// Braille spinners (Codex) and the half-circle spinner (Claude Code).
const SPINNER = /^[⠀-⣿◐-◓]/u;
// Status glyphs that agents put at the start of their titles.
const LEADING_GLYPH = /^[⠀-⣿◐-◓✳✱✻✢✶✽·•*]\s+/u;
// Codex blinks "[ ! ]" and "[ . ]" in its title while it waits for approval or input.
const ACTION_REQUIRED = /^\[\s*[!.]\s*\]\s*Action Required(?:\s*\|\s*)?/i;
// Claude Code's footer counts running background commands: "· 1 shell ·". The row shows the count, but it is
// not a state: a dev server runs on after the turn. Its "← 2 agents" also counts finished agents.
const BACKGROUND_SHELLS = /(?:^|·)\s*(\d+)\s+shells?\b/u;
// Codex shows "• Working (21m 58s • esc to interrupt) · 1 background terminal" above its prompt while a turn
// runs. Its hooks often do not reach Paseo (see OVERVIEW.md), and its title has no spinner then.
// Claude Code ends every dialog that waits for an answer with this hint: a question ("Enter to select · ↑/↓ to
// navigate · Esc to cancel"), a permission request ("Esc to cancel · Tab to amend"), the folder trust check
// ("Enter to confirm · Esc to cancel"). Its hooks still report "working" then.
const CLAUDE_DIALOG = /(?:^|\s)Esc to cancel(?:\s+·|\s*$)/u;
/** Codex's status line while a turn runs; it waits on a background command with the second form. */
const CODEX_WORKING = /(?:^|[\s•◦·])(?:Working|Waiting for background terminal) \(\d/u;

/** How many non-empty rows at the bottom of the screen hold the agent's footer, by agent. */
export const FOOTER_LINES: Readonly<Record<string, number>> = {
  claude: 3,
  // The working line sits above the prompt, and a typed prompt can take several rows.
  codex: 8,
};

/** "Claude Code" -> "claude", "Terminal 1" -> "shell", "Codex" -> "codex". */
export function agentName(profileName: string): string {
  const name = profileName.trim().toLowerCase();
  if (name.startsWith("claude")) return "claude";
  if (name === "" || /^terminal( \d+)?$/.test(name)) return "shell";
  return name.split(/\s+/)[0] ?? name;
}

/** Agents whose screens the plugin reads; other agents rely on hooks and titles only. */
const KNOWN_AGENTS = ["claude", "codex"] as const;

/** The parts of a Paseo terminal profile that name its agent. */
export interface ProfileIdentity {
  id: string;
  name: string;
  command: string;
  icon?: string;
}

/**
 * The agent of a terminal profile. The name is the user's label ("Review" can run Codex), so the command,
 * the icon and the id come first.
 */
export function profileAgent(profile: ProfileIdentity): string {
  const command = (profile.command.split(/[\\/]/).pop() ?? "").toLowerCase();
  const hints = [command, (profile.icon ?? "").toLowerCase(), profile.id.toLowerCase()];
  return KNOWN_AGENTS.find((agent) => hints.some((hint) => hint.startsWith(agent))) ?? agentName(profile.name);
}

/** The agent of a terminal: Paseo names a terminal after the profile that started it. */
export function terminalAgent(terminalName: string, profiles: readonly ProfileIdentity[]): string {
  const profile = profiles.find((candidate) => candidate.name === terminalName);
  return profile ? profileAgent(profile) : agentName(terminalName);
}

/** The title without the agent's status decoration. */
export function cleanTitle(title: string | null | undefined, fallback: string): string {
  const text = (title ?? "").replace(LEADING_GLYPH, "").replace(ACTION_REQUIRED, "").trim();
  return text || fallback;
}

export interface TerminalSignals {
  /** The terminal profile name, for example "Claude Code". */
  name: string;
  /** The agent, when the profile is known; otherwise it comes from the name. */
  agent?: string;
  title?: string | null;
  /** The state from the agent hooks; null when no hook reports for this terminal. */
  activity?: TerminalActivity | null;
  /** The last lines of the screen, for agents that show background work there. */
  footer?: string | null;
}

export interface TerminalStatus {
  status: TabStatus;
  detail: string | null;
}

export function backgroundShells(footer: string | null | undefined): number {
  const match = footer ? BACKGROUND_SHELLS.exec(footer) : null;
  return match?.[1] ? Number(match[1]) : 0;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function terminalStatus({ name, agent: knownAgent, title, activity, footer }: TerminalSignals): TerminalStatus {
  const agent = knownAgent ?? agentName(name);
  const text = title ?? "";
  const reason = activity?.attentionReason ?? null;
  const shells = agent === "claude" ? backgroundShells(footer) : 0;
  const codexWorking = agent === "codex" && CODEX_WORKING.test(footer ?? "");
  // Codex gets no detail: the symbol shows that it works, and its background count is long for a row.
  const detail = shells > 0 ? plural(shells, "shell") : null;
  const result = (status: TabStatus): TerminalStatus => ({ status, detail });

  // 1. The agent says on screen that it needs you: Codex in its title, Claude Code with a dialog.
  if (ACTION_REQUIRED.test(text)) return result("blocked");
  if (agent === "claude" && CLAUDE_DIALOG.test(footer ?? "")) return result("blocked");
  // 2. The hooks report a question or permission request. For Claude Code this reason comes only from the
  //    idle_prompt reminder (the prompt waited about 60 s), so it is handled as "done" below.
  if (reason === "needs_input" && agent !== "claude") return result("blocked");
  // 3. Codex says on screen that its turn runs.
  if (codexWorking) return result("working");
  // 4. Finished, and no client has shown the tab since.
  if (reason === "finished" || reason === "needs_input") return result("done");
  // 5. Working, from the hooks or from the agent's title spinner (the hooks can lag or be missing).
  if (activity?.state === "working" || SPINNER.test(text)) return result("working");
  if (activity) return result("idle");
  // 6. No hooks: an agent without a spinner waits; a plain shell has no agent state.
  return result(agent === "shell" ? "unknown" : "idle");
}

export function agentStatus(agent: Pick<RawAgent, "status" | "requiresAttention" | "attentionReason">): TabStatus {
  if (agent.requiresAttention) return agent.attentionReason === "finished" ? "done" : "blocked";
  if (agent.status === "running" || agent.status === "initializing") return "working";
  if (agent.status === "error") return "blocked";
  return "idle";
}
