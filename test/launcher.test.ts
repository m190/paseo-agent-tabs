import assert from "node:assert/strict";
import { test } from "node:test";
import * as rules from "@getpaseo/protocol/terminal-profiles";
import type { HostDaemon } from "../server/host-daemon";
import { TabLauncher } from "../server/launcher";
import { TabSource } from "../server/tab-source";

const PROFILES = [
  { id: "claude", name: "Claude Code", command: "claude", args: ["--dangerously-skip-permissions", "{{{prompt}}}"], icon: "claude" },
  { id: "codex", name: "Codex", command: "codex", args: ["--yolo", "{{{prompt}}}"], icon: "codex" },
];

interface CreateCall {
  cwd: string;
  name?: string;
  options?: { workspaceId?: string; command?: string; args?: string[] };
}

class FakeDaemon {
  creates: CreateCall[] = [];
  closes: { agentIds?: string[]; terminalIds?: string[] }[] = [];
  /** Terminal ids the daemon fails to stop. */
  stuck = new Set<string>();
  async listTerminals() {
    return { terminals: [] };
  }
  async fetchAgents() {
    return { entries: [], pageInfo: { nextCursor: null } };
  }
  async listProjects() {
    return { projects: [{ projectId: "p1", projectKey: "remote:github.com/acme/project" }] };
  }
  getLastServerInfoMessage() {
    return { serverId: "srv_test" };
  }
  async fetchWorkspaces() {
    return {
      entries: [
        {
          id: "w1",
          projectDisplayName: "project",
          projectCustomName: null,
          projectRootPath: "/repo",
          workspaceDirectory: "/repo/worktree",
          workspaceKind: "worktree",
          name: "feature",
          title: null,
        },
      ],
      pageInfo: { nextCursor: null },
    };
  }
  async getDaemonConfig() {
    return { config: { terminalProfiles: PROFILES } };
  }
  async createTerminal(cwd: string, name?: string, _requestId?: string, options?: CreateCall["options"]) {
    this.creates.push({ cwd, name, options });
    return { terminal: { id: `t${this.creates.length}`, name: name ?? "Terminal" }, error: null };
  }
  async closeItems(input: { agentIds?: string[]; terminalIds?: string[] }) {
    this.closes.push(input);
    return {
      agents: (input.agentIds ?? []).map((agentId) => ({ agentId, archivedAt: "2026-11-11T00:00:00Z" })),
      terminals: (input.terminalIds ?? []).map((terminalId) => ({ terminalId, success: !this.stuck.has(terminalId) })),
      requestId: "r1",
    };
  }
  async captureTerminal() {
    return { lines: [], totalLines: 0 };
  }
  async close() {}
}

function setup() {
  const daemon = new FakeDaemon();
  const source = new TabSource(async () => daemon as unknown as HostDaemon);
  return { daemon, launcher: new TabLauncher(source, async () => rules) };
}

test("lists the configured profiles and a plain terminal", async () => {
  const { launcher } = setup();
  const profiles = await launcher.profiles();
  assert.deepEqual(
    profiles.map((profile) => [profile.id, profile.name, profile.takesPrompt]),
    [
      ["claude", "Claude Code", true],
      ["codex", "Codex", true],
      [null, "Terminal", false],
    ],
  );
});

test("starts a profile in the workspace folder with the first prompt", async () => {
  const { daemon, launcher } = setup();
  const created = await launcher.create("w1", "claude", "  fix the tests  ");
  assert.deepEqual(created, { terminalId: "t1", workspaceId: "w1", name: "Claude Code" });
  assert.deepEqual(daemon.creates[0], {
    cwd: "/repo/worktree",
    name: "Claude Code",
    options: { workspaceId: "w1", command: "claude", args: ["--dangerously-skip-permissions", "fix the tests"] },
  });
});

test("without a prompt, the prompt argument is left out", async () => {
  const { daemon, launcher } = setup();
  await launcher.create("w1", "codex", "");
  assert.deepEqual(daemon.creates[0]?.options, { workspaceId: "w1", command: "codex", args: ["--yolo"] });
});

test("a plain terminal starts the default shell", async () => {
  const { daemon, launcher } = setup();
  await launcher.create("w1", null, "ignored");
  assert.deepEqual(daemon.creates[0], { cwd: "/repo/worktree", name: undefined, options: { workspaceId: "w1" } });
});

test("unknown workspaces and profiles are errors", async () => {
  const { launcher } = setup();
  await assert.rejects(launcher.create("missing", "claude", ""), /Unknown workspace/);
  await assert.rejects(launcher.create("w1", "nope", ""), /Unknown terminal profile/);
});

test("closing stops a terminal or archives an agent, as the app does", async () => {
  const { daemon, launcher } = setup();
  assert.deepEqual(await launcher.close("terminal", "t9"), { closed: true });
  assert.deepEqual(await launcher.close("agent", "a1"), { closed: true });
  assert.deepEqual(daemon.closes, [{ terminalIds: ["t9"] }, { agentIds: ["a1"] }]);
});

test("a terminal the daemon could not stop is an error", async () => {
  const { daemon, launcher } = setup();
  daemon.stuck.add("t9");
  await assert.rejects(launcher.close("terminal", "t9"), /did not close the terminal/);
});
