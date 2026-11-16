import assert from "node:assert/strict";
import test from "node:test";
import { addTabOpener, openTabInApp, showSidebarView, sidebarViewShown, subscribeSidebarView } from "../client/hub";

test("the sidebar view is shown while at least one view is on screen", () => {
  let calls = 0;
  const unsubscribe = subscribeSidebarView(() => calls++);
  assert.equal(sidebarViewShown(), false);
  const hideFirst = showSidebarView();
  const hideSecond = showSidebarView();
  assert.equal(sidebarViewShown(), true);
  hideFirst();
  assert.equal(sidebarViewShown(), true);
  hideSecond();
  assert.equal(sidebarViewShown(), false);
  assert.equal(calls, 4);
  unsubscribe();
  showSidebarView()();
  assert.equal(calls, 4);
});

test("a tab opens with the newest opener that can, and an opener that fails does not stop the others", () => {
  const tab = { kind: "terminal", id: "t1" } as const;
  assert.equal(openTabInApp("srv", tab), false);
  const calls: string[] = [];
  const removeOld = addTabOpener((serverId, { id }) => {
    calls.push(`old ${serverId} ${id}`);
    return true;
  });
  const removeUnknown = addTabOpener(() => {
    calls.push("unknown");
    return false;
  });
  const removeBroken = addTabOpener(() => {
    calls.push("broken");
    throw new Error("the app does not know the terminal");
  });
  assert.equal(openTabInApp("srv", tab), true);
  assert.deepEqual(calls, ["broken", "unknown", "old srv t1"]);
  removeOld();
  assert.equal(openTabInApp("srv", tab), false);
  removeUnknown();
  removeBroken();
});
