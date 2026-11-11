import assert from "node:assert/strict";
import { test } from "node:test";
import { trimPreview } from "../server/preview";

const rule = "─".repeat(40);

test("removes an agent's input box and status bar", () => {
  const lines = ["output 1", "output 2", "", rule, "❯ ", rule, "  ~/repos/shop", "  ⏵⏵ bypass permissions on"];
  assert.deepEqual(trimPreview(lines, 8), ["output 1", "output 2"]);
});

test("keeps normal shell output that contains horizontal lines", () => {
  const lines = ["header", rule, "important result", rule, "trailing line"];
  assert.deepEqual(trimPreview(lines, 8), lines);
});

test("returns the last non-empty lines", () => {
  const lines = ["a", "", "b", "c", "", ""];
  assert.deepEqual(trimPreview(lines, 2), ["b", "c"]);
  assert.deepEqual(trimPreview(lines, 3), ["a", "b", "c"]);
});

test("finds the input box above many empty rows", () => {
  const lines = ["output", rule, "❯", rule, "  ~/repos/admin", "  ⏵⏵ bypass permissions on", ...Array(30).fill("")];
  assert.deepEqual(trimPreview(lines, 4), ["output"]);
});

test("removes Codex's prompt and status line", () => {
  const lines = ["  permissions: YOLO mode", "  Tip: run codex app", "", "› Ask Codex to do anything", "", "  GPT-6.1 high · ~/code/weather"];
  assert.deepEqual(trimPreview(lines, 4), ["  permissions: YOLO mode", "  Tip: run codex app"]);
});
