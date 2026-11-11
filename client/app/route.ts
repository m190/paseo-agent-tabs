import { createElement, useCallback } from "react";
import { Platform, View } from "react-native";
import { type ShownWorkspace, workspaceRef } from "../../shared/app-view";
import { type AppNavigation, getAppNavigation, setAppNavigation } from "../hub";

// The native app does not tell plugins which workspace it shows. Plugin code there cannot load app modules,
// but a plugin view is part of the app's React tree. In the app's React Native build, a view's instance holds
// its React fiber in `__internalInstanceHandle`. From the fiber the plugin walks to the tree root, and finds
// React Navigation's container: a context provider whose value has `getCurrentRoute`. This depends on React
// and React Native internals; when it fails, the plugin has no view of the native app (see view.ts).

interface Fiber {
  return?: Fiber | null;
  child?: Fiber | null;
  sibling?: Fiber | null;
  memoizedProps?: { value?: unknown } | null;
}

const MAX_VISITS = 50_000;

function isNavigation(value: unknown): value is AppNavigation {
  return typeof value === "object" && value !== null && typeof (value as Partial<AppNavigation>).getCurrentRoute === "function";
}

function findNavigation(instance: unknown): AppNavigation | null {
  let fiber = (instance as { __internalInstanceHandle?: Fiber } | null)?.__internalInstanceHandle;
  if (!fiber || typeof fiber !== "object") return null;
  while (fiber.return) fiber = fiber.return;
  // Depth first from the root: the container is near the top.
  const stack: Fiber[] = [fiber];
  for (let visits = 0; stack.length > 0 && visits < MAX_VISITS; visits++) {
    const node = stack.pop()!;
    const value = node.memoizedProps?.value;
    if (isNavigation(value)) return value;
    if (node.sibling) stack.push(node.sibling);
    if (node.child) stack.push(node.child);
  }
  return null;
}

function capture(instance: unknown): void {
  if (!instance) return;
  try {
    const navigation = findNavigation(instance);
    if (navigation) setAppNavigation(navigation);
  } catch {
    // Keep the last navigation, or none.
  }
}

/** An empty view that finds the app's navigation when it mounts (native app only). */
export function RouteAnchor() {
  const ref = useCallback((instance: unknown) => capture(instance), []);
  return Platform.OS === "web" ? null : createElement(View, { ref, pointerEvents: "none", style: { position: "absolute", width: 0, height: 0 } });
}

/**
 * The workspace that the native app shows. Null when it shows another screen; undefined when the plugin
 * cannot read the app's route.
 */
export function shownWorkspace(): ShownWorkspace | null | undefined {
  const navigation = getAppNavigation();
  if (!navigation) return undefined;
  try {
    const route = navigation.getCurrentRoute();
    if (!route) return undefined;
    const { serverId, workspaceId } = route.params ?? {};
    return typeof serverId === "string" && typeof workspaceId === "string" ? { serverId, ref: workspaceRef(serverId, workspaceId) } : null;
  } catch {
    return undefined;
  }
}
