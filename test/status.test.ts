import assert from "node:assert/strict";
import { test } from "node:test";
import { agentName, agentStatus, cleanTitle, profileAgent, terminalAgent, terminalStatus } from "../server/status";

const idle = { state: "idle" as const, changedAt: 1 };
const working = { state: "working" as const, changedAt: 1 };
const finished = { state: "idle" as const, attentionReason: "finished" as const, changedAt: 1 };
const needsInput = { state: "idle" as const, attentionReason: "needs_input" as const, changedAt: 1 };
const claudeFooter = "~/repos/shop ⏵⏵ bypass permissions on · PR #482 · 1 shell · ← 2 agents";

test("agentName maps terminal profiles", () => {
  assert.equal(agentName("Claude Code"), "claude");
  assert.equal(agentName("Codex"), "codex");
  assert.equal(agentName("Terminal 1"), "shell");
  assert.equal(agentName("OpenCode"), "opencode");
});

test("cleanTitle removes status decoration", () => {
  assert.equal(cleanTitle("✳ PR 321 review", "x"), "PR 321 review");
  assert.equal(cleanTitle("◐ Paseo plugin", "x"), "Paseo plugin");
  assert.equal(cleanTitle("[ ! ] Action Required | Check prod last 2h | weather", "x"), "Check prod last 2h | weather");
  assert.equal(cleanTitle("[ . ] Action Required | Check prod", "x"), "Check prod");
  assert.equal(cleanTitle("", "Terminal 1"), "Terminal 1");
});

test("Codex 'Action Required' is blocked with or without hook data", () => {
  const title = "[ ! ] Action Required | Check prod";
  assert.equal(terminalStatus({ name: "Codex", title, activity: null }).status, "blocked");
  assert.equal(terminalStatus({ name: "Codex", title, activity: idle }).status, "blocked");
  assert.equal(terminalStatus({ name: "Codex", title: "[ . ] Action Required | x", activity: working }).status, "blocked");
});

test("needs_input is blocked for Codex but done for Claude's idle reminder", () => {
  assert.equal(terminalStatus({ name: "Codex", title: "x", activity: needsInput }).status, "blocked");
  assert.equal(terminalStatus({ name: "Claude Code", title: "✳ x", activity: needsInput }).status, "done");
});

test("finished is done until a client shows the tab", () => {
  assert.equal(terminalStatus({ name: "Claude Code", title: "✳ x", activity: finished }).status, "done");
});

test("a background shell keeps Claude working, with a detail", () => {
  assert.deepEqual(terminalStatus({ name: "Claude Code", title: "✳ x", activity: idle, footer: claudeFooter }), {
    status: "working",
    detail: "1 shell",
  });
  assert.equal(terminalStatus({ name: "Claude Code", title: "✳ x", activity: finished, footer: "· 3 shells" }).detail, "3 shells");
});

test("'← 2 agents' alone is not work", () => {
  assert.equal(terminalStatus({ name: "Claude Code", title: "✳ x", activity: idle, footer: "bypass on · ← 2 agents" }).status, "idle");
});

test("working comes from the hooks or from the title spinner", () => {
  assert.equal(terminalStatus({ name: "Claude Code", title: "✳ x", activity: working }).status, "working");
  assert.equal(terminalStatus({ name: "Claude Code", title: "◑ x", activity: idle }).status, "working");
  assert.equal(terminalStatus({ name: "Codex", title: "⠴ Check prod", activity: null }).status, "working");
});

test("without hooks, an agent is idle and a plain shell is unknown", () => {
  assert.equal(terminalStatus({ name: "Codex", title: "Check prod", activity: null }).status, "idle");
  assert.equal(terminalStatus({ name: "Terminal 1", title: "python3 -m tool", activity: null }).status, "unknown");
});

test("agentStatus maps Paseo agents", () => {
  assert.equal(agentStatus({ status: "running", requiresAttention: false, attentionReason: null }), "working");
  assert.equal(agentStatus({ status: "idle", requiresAttention: true, attentionReason: "finished" }), "done");
  assert.equal(agentStatus({ status: "idle", requiresAttention: true, attentionReason: "permission" }), "blocked");
  assert.equal(agentStatus({ status: "idle", requiresAttention: false, attentionReason: null }), "idle");
});

test("Codex is working while its screen shows the working line", () => {
  const footer = "output • Working (21m 58s • esc to interrupt) · 1 background terminal › Ask Codex to do anything GPT-6.1 high · ~/x";
  assert.deepEqual(terminalStatus({ name: "Codex", title: "weather", activity: null, footer }), {
    status: "working",
    detail: null,
  });
  // A truncated line on a narrow screen still counts.
  assert.equal(terminalStatus({ name: "Codex", title: "x", activity: null, footer: "• Working (5s • esc to inter…" }).status, "working");
  // Waiting on a background command is work too.
  assert.deepEqual(
    terminalStatus({ name: "Codex", title: "x", activity: null, footer: "• Waiting for background terminal (32m 31s • esc… › Ask Codex" }),
    { status: "working", detail: null },
  );
  // The finished line is not work.
  assert.equal(terminalStatus({ name: "Codex", title: "x", activity: null, footer: "Worked for 30m 49s • 21:07 › Ask Codex" }).status, "idle");
  // The approval title still wins.
  assert.equal(terminalStatus({ name: "Codex", title: "[ ! ] Action Required | x", activity: null, footer }).status, "blocked");
});

test("a Claude dialog that waits for an answer is blocked, even while the hooks say working", () => {
  // The bottom three non-empty rows, joined as tab-source does, from real Claude Code screens.
  const question = "──────── 5. Chat about this Enter to select · ↑/↓ to navigate · Esc to cancel";
  const permission = "3. Yes, and switch to auto mode · auto mode handles these prompts for you 4. No Esc to cancel · Tab to amend";
  const trust = "❯ No, exit Yes, I trust this folder Enter to confirm · Esc to cancel";
  for (const footer of [question, permission, trust]) {
    assert.equal(terminalStatus({ name: "Claude Code", title: "✳ Color question", activity: working, footer }).status, "blocked");
  }
});

test("Claude's usual footer and other agents' text are not a dialog", () => {
  assert.equal(terminalStatus({ name: "Claude Code", title: "x", activity: working, footer: claudeFooter }).status, "working");
  const typed = "❯ tell me what Esc to cancel means ──── ⏵⏵ bypass permissions on";
  assert.equal(terminalStatus({ name: "Claude Code", title: "x", activity: working, footer: typed }).status, "working");
  assert.equal(terminalStatus({ name: "Codex", title: "x", activity: working, footer: "Esc to cancel" }).status, "working");
});

test("the agent of a profile comes from its command, icon or id before its name", () => {
  assert.equal(profileAgent({ id: "review", name: "Review", command: "/opt/homebrew/bin/codex" }), "codex");
  assert.equal(profileAgent({ id: "mine", name: "My helper", command: "claude" }), "claude");
  assert.equal(profileAgent({ id: "yolo", name: "Fast", command: "npx", icon: "codex" }), "codex");
  assert.equal(profileAgent({ id: "claude-plan", name: "Plan", command: "env" }), "claude");
  assert.equal(profileAgent({ id: "aider", name: "Aider", command: "aider" }), "aider");
});

test("a terminal takes the agent of the profile with its name, else the name", () => {
  const profiles = [{ id: "review", name: "Review", command: "codex" }];
  assert.equal(terminalAgent("Review", profiles), "codex");
  assert.equal(terminalAgent("Claude Code", profiles), "claude");
  assert.equal(terminalAgent("Terminal 2", profiles), "shell");
});
