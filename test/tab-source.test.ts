import assert from "node:assert/strict";
import { test } from "node:test";
import { mapLimit } from "../shared/async";
import type { HostDaemon } from "../server/host-daemon";
import { TabSource } from "../server/tab-source";

interface FakeTerminal {
  id: string;
  name: string;
  workspaceId: string;
  title?: string;
  activity?: { state: "idle" | "working"; attentionReason?: "finished" | "needs_input"; changedAt: number } | null;
}

class FakeDaemon {
  terminals: FakeTerminal[] = [];
  listCalls = 0;
  closed = false;
  fail: Error | null = null;
  gate: Promise<void> | null = null;
  screens = new Map<string, string[]>();
  serverId: string | null = "srv_test";

  async listTerminals() {
    this.listCalls += 1;
    if (this.gate) await this.gate;
    if (this.fail) throw this.fail;
    return { terminals: this.terminals };
  }
  async fetchAgents() {
    return { entries: [], pageInfo: { nextCursor: null } };
  }
  async listProjects() {
    return { projects: [{ projectId: "p1", projectKey: "remote:github.com/acme/project" }] };
  }
  getLastServerInfoMessage() {
    return { serverId: this.serverId };
  }
  async fetchWorkspaces() {
    return {
      entries: [{ id: "w1", projectId: "p1", projectDisplayName: "project", projectCustomName: null, workspaceKind: "local_checkout", name: "main", title: null }],
      pageInfo: { nextCursor: null },
    };
  }
  async captureTerminal(id: string) {
    const lines = this.screens.get(id);
    if (!lines) throw new Error("no screen");
    return { lines, totalLines: lines.length };
  }
  async close() {
    this.closed = true;
  }
}

function source(daemons: FakeDaemon[], now = () => 1_000) {
  let index = 0;
  return new TabSource(async () => daemons[Math.min(index++, daemons.length - 1)] as unknown as HostDaemon, now);
}

test("parallel list requests share one daemon round", async () => {
  const daemon = new FakeDaemon();
  daemon.terminals = [{ id: "t1", name: "Terminal 1", workspaceId: "w1", title: "zsh" }];
  let release!: () => void;
  daemon.gate = new Promise((resolve) => (release = resolve));
  const tabs = source([daemon]);
  const first = tabs.list();
  const second = tabs.list();
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(daemon.listCalls, 1);
  assert.equal(a, b);
  assert.equal(a.groups[0]?.projectName, "project");
});

test("a failure keeps the last good list and reports the error", async () => {
  const daemon = new FakeDaemon();
  daemon.terminals = [{ id: "t1", name: "Terminal 1", workspaceId: "w1" }];
  let time = 0;
  const tabs = source([daemon, daemon], () => time);
  const good = await tabs.list();
  assert.equal(good.error, null);
  daemon.fail = new Error("socket closed");
  time = 5_000;
  const bad = await tabs.list();
  assert.equal(bad.error, "socket closed");
  assert.deepEqual(bad.groups, good.groups);
});

test("an old failed request does not close the newer connection", async () => {
  const old = new FakeDaemon();
  const fresh = new FakeDaemon();
  fresh.terminals = [{ id: "t1", name: "Terminal 1", workspaceId: "w1" }];
  let time = 0;
  const tabs = source([old, fresh], () => time);
  let release!: () => void;
  old.gate = new Promise((resolve) => (release = resolve));
  old.fail = new Error("old failure");
  const slow = tabs.list();
  // The preview path fails on the same connection and replaces it first.
  await tabs.previews(["missing"], 4);
  time = 5_000;
  release();
  await slow;
  const next = await tabs.list();
  assert.equal(old.closed, true);
  assert.equal(fresh.closed, false);
  assert.equal(next.error, null);
});

test("statusSince starts with the daemon time and moves only on a status change", async () => {
  const daemon = new FakeDaemon();
  const terminal: FakeTerminal = { id: "t1", name: "Claude Code", workspaceId: "w1", title: "✳ x", activity: { state: "idle", changedAt: 100 } };
  daemon.terminals = [terminal];
  daemon.screens.set("t1", ["❯", "footer"]);
  let time = 1_000;
  const tabs = source([daemon], () => time);
  assert.equal((await tabs.list()).groups[0]?.tabs[0]?.statusSince, 100);
  time = 3_000;
  assert.equal((await tabs.list()).groups[0]?.tabs[0]?.statusSince, 100);
  terminal.title = "◐ x";
  time = 5_000;
  const changed = (await tabs.list()).groups[0]?.tabs[0];
  assert.equal(changed?.status, "working");
  assert.equal(changed?.statusSince, 5_000);
});

test("previews leave out terminals that could not be read", async () => {
  const daemon = new FakeDaemon();
  daemon.screens.set("t1", ["hello"]);
  const { previews } = await source([daemon]).previews(["t1", "t2"], 4);
  assert.deepEqual(previews, { t1: ["hello"] });
});

test("mapLimit keeps the order and the limit", async () => {
  let running = 0;
  let peak = 0;
  const results = await mapLimit([1, 2, 3, 4, 5], 2, async (value) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running -= 1;
    return value * 10;
  });
  assert.deepEqual(results, [10, 20, 30, 40, 50]);
  assert.equal(peak, 2);
});

test("color keys follow Paseo: the project key when unique, else host and project ids", async () => {
  const { colorKeys } = await import("../server/tab-source");
  const keys = colorKeys(
    [
      { projectId: "a", projectKey: "remote:x" },
      { projectId: "b", projectKey: "remote:y" },
      { projectId: "c", projectKey: "remote:y" },
      { projectId: "d" },
    ],
    "srv",
  );
  assert.equal(keys.get("a"), "remote:x");
  assert.equal(keys.get("b"), JSON.stringify(["srv", "b"]));
  assert.equal(keys.get("d"), JSON.stringify(["srv", "d"]));
});

test("workspace info carries the color key", async () => {
  const daemon = new FakeDaemon();
  daemon.terminals = [{ id: "t1", name: "Terminal 1", workspaceId: "w1" }];
  const list = await source([daemon]).list();
  assert.equal(list.groups[0]?.colorKey, "remote:github.com/acme/project");
  assert.equal(list.serverId, "srv_test");
});

test("the footer is found above the empty rows of a tall terminal", async () => {
  const daemon = new FakeDaemon();
  daemon.terminals = [{ id: "t1", name: "Claude Code", workspaceId: "w1", title: "✳ x", activity: { state: "idle", changedAt: 1 } }];
  daemon.screens.set("t1", ["output", "────", "❯", "────", "  ~/repo", "  ⏵⏵ bypass permissions on · 1 shell", ...Array(40).fill("")]);
  const tab = (await source([daemon]).list()).groups[0]?.tabs[0];
  // The detail shows that the footer was found; a background shell does not change the state.
  assert.equal(tab?.status, "idle");
  assert.equal(tab?.detail, "1 shell");
});

test("a daemon without a host id gives an error, not a list that the client would hide", async () => {
  const daemon = new FakeDaemon();
  daemon.terminals = [{ id: "t1", name: "Terminal 1", workspaceId: "w1" }];
  daemon.serverId = null;
  const list = await source([daemon]).list();
  assert.match(list.error ?? "", /host id/);
  assert.equal(list.groups.length, 0);
});

const codexWorkingScreen = ["output", "• Working (12s • esc to interrupt)", "", "› Ask Codex to do anything", "", "  gpt-5.5 high · ~/repo"];

test("a renamed Codex profile still gets Codex's screen rules", async () => {
  const daemon = new FakeDaemon();
  daemon.terminals = [{ id: "t1", name: "Review", workspaceId: "w1", title: "Review", activity: null }];
  daemon.screens.set("t1", codexWorkingScreen);
  const profiles = async () => [{ id: "review", name: "Review", command: "/opt/homebrew/bin/codex" }];
  const tab = (await new TabSource(async () => daemon as unknown as HostDaemon, () => 1_000, profiles).list()).groups[0]?.tabs[0];
  assert.equal(tab?.agent, "codex");
  assert.equal(tab?.status, "working");
  // Without the profile list, the name is all there is: an unknown agent without hooks is idle.
  const plain = (await source([daemon]).list()).groups[0]?.tabs[0];
  assert.equal(plain?.agent, "review");
  assert.equal(plain?.status, "idle");
});

test("a failed capture keeps the last screen for a short time", async () => {
  const daemon = new FakeDaemon();
  daemon.terminals = [{ id: "t1", name: "Codex", workspaceId: "w1", title: "fix bug", activity: null }];
  daemon.screens.set("t1", codexWorkingScreen);
  let now = 1_000;
  const tabs = source([daemon], () => now);
  assert.equal((await tabs.list()).groups[0]?.tabs[0]?.status, "working");
  daemon.screens.delete("t1"); // the next captures fail
  now += 5_000;
  assert.equal((await tabs.list()).groups[0]?.tabs[0]?.status, "working");
  now += 10_000;
  assert.equal((await tabs.list()).groups[0]?.tabs[0]?.status, "idle");
});
