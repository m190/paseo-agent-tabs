import { settingsRpc } from "@getpaseo/plugin";
import { useSettings } from "@getpaseo/plugin/client";
import { useEffect, useSyncExternalStore } from "react";
import { DEFAULT_VIEW, type View, VIEW_SETTINGS } from "../shared/view-settings";
import { getSources, type HostSource } from "./hub";
import { ownSource } from "./store";

// A change shows at once in every component; the daemon saves it in the background. The override goes away
// when the save succeeds, so the stored value (also a change from another device) shows again.
let pending: Partial<View> = {};
const listeners = new Set<() => void>();

function setPending(next: Partial<View>): void {
  pending = next;
  for (const listener of listeners) listener();
}

function usePending(): Partial<View> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => pending,
    () => pending,
  );
}

const viewRpc = settingsRpc(VIEW_SETTINGS.id);

/**
 * Settings are stored per host, and the app shows the copy of the host of the open screen. So a change
 * saves all values of this host on the other hosts too, and the list looks the same on every host. A
 * failure there is ignored: that host keeps its old values until the next change.
 */
async function saveOnHost(source: HostSource, values: View): Promise<void> {
  const current = await source.rpc(viewRpc.read, {});
  await source.rpc(viewRpc.write, { revision: current.revision, values });
}

function saveOnOtherHosts(values: View): void {
  const own = ownSource();
  const done = new Set(own?.serverId ? [own.serverId] : []);
  for (const source of [...getSources()].reverse()) {
    if (source === own || !source.serverId || done.has(source.serverId)) continue;
    done.add(source.serverId);
    void saveOnHost(source, values).catch(() => {});
  }
}

// A change that this host has not saved yet: made before the settings loaded, or a save that failed (for
// example because another device saved first). It is saved when the settings are (again) ready.
let unsaved = false;
let failedSaves = 0;
const MAX_SAVE_TRIES = 3;

const useViewSettings = () => useSettings(VIEW_SETTINGS);
type SettingsState = ReturnType<typeof useViewSettings>;

function saveOwn(state: SettingsState): void {
  if (state.status !== "ready") {
    unsaved = true;
    return;
  }
  unsaved = false;
  const patch = pending;
  void state.save({ ...state.values, ...patch }, state.revision).then((ok) => {
    if (ok) {
      failedSaves = 0;
      // Drop the keys this save stored, unless the user changed them again meanwhile.
      setPending(Object.fromEntries(Object.entries(pending).filter(([key, value]) => patch[key as keyof View] !== value)));
    } else if (++failedSaves < MAX_SAVE_TRIES) {
      unsaved = true; // tried again with the next revision
    } else {
      // Give up, so the stored value (also a change from another device) shows again.
      failedSaves = 0;
      setPending({});
    }
  });
}

function useViewValue<K extends keyof View>(key: K): [View[K], (next: View[K]) => void] {
  const state = useViewSettings();
  const override = usePending();
  const saved = state.status === "ready" ? state.values : DEFAULT_VIEW;
  const value = (key in override ? override[key] : saved[key]) as View[K];
  const revision = state.status === "ready" ? state.revision : null;
  useEffect(() => {
    if (unsaved && state.status === "ready") saveOwn(state);
    // The state object changes on every render; the status and the revision say when a save can run.
  }, [state.status, revision]);
  const set = (next: View[K]) => {
    setPending({ ...pending, [key]: next });
    saveOnOtherHosts({ ...saved, ...pending });
    saveOwn(state);
  };
  return [value, set];
}

export const useSort = () => useViewValue("sort");
export const useCollapsed = () => useViewValue("collapsed");
export const useHostMode = () => useViewValue("hosts");
