import { useCallback, useEffect, useMemo, useRef } from "react";
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollView } from "react-native";
import { scrollPositions } from "./hub";

/** After this, a list that is still too short for the saved position scrolls as far as it can. */
const WAIT_FOR_ROWS_MS = 3_000;

/**
 * Keeps a list's scroll position when a new ScrollView takes its place. The sidebar shows the copy of the open
 * screen's host, so opening a tab on another host mounts a new list, which starts at the top; folding the list
 * does the same. Spread the returned props on the ScrollView, and call `onContentSizeChange` from its own.
 */
export function useKeptScroll(key: string) {
  const view = useRef<ScrollView | null>(null);
  const size = useRef({ content: 0, viewport: 0 });
  // The position this ScrollView goes back to; null once it is there, or once the user scrolled.
  const target = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopWaiting = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const restore = useCallback((force: boolean) => {
    const y = target.current;
    const { content, viewport } = size.current;
    if (y === null || !view.current || viewport === 0) return;
    const max = Math.max(0, content - viewport);
    if (max + 1 < y && !force) return; // More rows can still arrive. The 1 allows for rounding.
    target.current = null;
    stopWaiting();
    view.current.scrollTo({ y: Math.min(y, max), animated: false });
  }, []);

  const ref = useCallback(
    (node: ScrollView | null) => {
      view.current = node;
      stopWaiting();
      size.current = { content: 0, viewport: 0 };
      target.current = node ? scrollPositions().get(key) || null : null;
      if (target.current !== null) timer.current = setTimeout(() => restore(true), WAIT_FOR_ROWS_MS);
    },
    [key, restore],
  );

  useEffect(() => stopWaiting, []);

  return useMemo(() => {
    const save = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = event.nativeEvent.contentOffset.y;
      if (target.current !== null) {
        // A new list starts at 0, so a scroll to another position before the restore comes from the user.
        if (y === 0) return;
        target.current = null;
        stopWaiting();
      }
      scrollPositions().set(key, y);
    };
    return {
      ref,
      onScroll: save,
      onScrollEndDrag: save,
      onMomentumScrollEnd: save,
      scrollEventThrottle: 16,
      onLayout: (event: LayoutChangeEvent) => {
        size.current.viewport = event.nativeEvent.layout.height;
        restore(false);
      },
      onContentSizeChange: (_width: number, height: number) => {
        size.current.content = height;
        restore(false);
      },
    };
  }, [key, ref, restore]);
}
