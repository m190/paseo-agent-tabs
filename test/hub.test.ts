import assert from "node:assert/strict";
import test from "node:test";
import { showSidebarView, sidebarViewShown, subscribeSidebarView } from "../client/hub";

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
