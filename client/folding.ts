import { useMemo } from "react";
import { type Combined, foldAll, groupKey, type HostGroup, toggleFolded } from "./model";
import { useFolded, useViewReady } from "./prefs";

/** The folded projects as a set, and a function that folds or unfolds one project. */
export function useFolding(combined: Pick<Combined, "groups" | "hosts" | "workspaces">): {
  folded: ReadonlySet<string>;
  /** False until the stored folds have loaded: a change before then would replace them. */
  ready: boolean;
  toggle(group: HostGroup): void;
  setAll(fold: boolean): void;
} {
  const [folded, setFolded] = useFolded();
  const ready = useViewReady();
  const set = useMemo(() => new Set(folded), [folded]);
  const known = [...combined.workspaces, ...combined.groups];
  const toggle = (group: HostGroup) => {
    if (ready) setFolded(toggleFolded(folded, groupKey(group), known, combined.hosts));
  };
  const setAll = (fold: boolean) => {
    if (ready) setFolded(foldAll(folded, combined.groups, fold, known, combined.hosts));
  };
  return { folded: set, ready, toggle, setAll };
}
