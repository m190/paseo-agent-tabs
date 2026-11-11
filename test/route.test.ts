import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_PADDING, nextPadding, tabRoute, workspaceSegment } from "../shared/route";

test("workspace ids follow the app's path encoding", () => {
  assert.equal(workspaceSegment("wks_0123456789abcdef"), "wks_0123456789abcdef");
  // The app's encodeWorkspaceIdForPathSegment: "b64_" + base64url of the UTF-8 bytes, without "=".
  assert.equal(workspaceSegment("/Users/me/repo"), `b64_${Buffer.from("/Users/me/repo").toString("base64url")}`);
  assert.equal(workspaceSegment("dir/ž ✓ 😀"), `b64_${Buffer.from("dir/ž ✓ 😀").toString("base64url")}`);
});

test("the padding goes after the colon, so the trimmed value changes but the id does not", () => {
  const route = tabRoute("srv_1", { kind: "terminal", id: "abc", workspaceId: "wks_1" }, 2);
  assert.equal(route, "/h/srv_1/workspace/wks_1?open=terminal%3A%20%20abc");
  const open = decodeURIComponent(route.split("open=")[1]!).trim();
  assert.equal(open, "terminal:  abc");
  assert.equal(open.slice(open.indexOf(":") + 1).trim(), "abc");
});

test("the next padding is in range and never the last one", () => {
  for (const last of [undefined, 1, 2, 24, MAX_PADDING - 1, MAX_PADDING]) {
    for (const r of [0, 0.25, 0.5, 0.999999]) {
      const padding = nextPadding(last, () => r);
      assert.ok(padding >= 1 && padding <= MAX_PADDING, `${padding} for last ${last}`);
      assert.notEqual(padding, last);
    }
  }
});
