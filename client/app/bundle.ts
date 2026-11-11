import { Platform } from "react-native";
import { withTimeout } from "../../shared/async";

// This plugin typechecks without the DOM library. Declare only what this module uses.
declare const document: { scripts: ArrayLike<{ src: string }> };
declare function fetch(url: string): Promise<{ ok: boolean; text(): Promise<string> }>;

// The app gives plugins no API for some of its state. On web and desktop the plugin runs in the app's page, so
// it finds the app module in the app bundle and loads it through Metro's `__r`. This depends on the app's
// build: callers must work without the module.

const BUNDLE = /\/_expo\/static\/js\/web\/index-[^/]+\.js/;
const FETCH_TIMEOUT_MS = 4_000;
const LOOKUP_TIMEOUT_MS = 6_000;
const RETRY_MS = 30_000;
const SHARE_MS = 10_000;

type MetroRequire = (id: number) => unknown;

/** Runs `load` one time and keeps the answer; after a failure (null), runs it again at a call `RETRY_MS` later. */
function retrying<T>(load: () => Promise<T | null>): () => Promise<T | null> {
  let pending: Promise<T | null> | null = null;
  let failedAt = 0;
  return () => {
    if (!pending || (failedAt > 0 && Date.now() - failedAt > RETRY_MS)) {
      failedAt = 0;
      pending = load().then((value) => {
        if (value === null) failedAt = Date.now();
        return value;
      });
    }
    return pending;
  };
}

/** Fetches the app bundles' code; null when none loads. */
async function loadBundles(): Promise<string[] | null> {
  const sources = Array.from(document.scripts, (script) => script.src).filter((src) => BUNDLE.test(src));
  const load = Promise.all(
    sources.map(async (src) => {
      try {
        const response = await fetch(src);
        return response.ok ? await response.text() : "";
      } catch {
        return "";
      }
    }),
  ).then((codes) => codes.filter((code) => code.length > 0));
  const codes = await withTimeout(load, FETCH_TIMEOUT_MS, "Bundle fetch timed out").catch(() => []);
  return codes.length > 0 ? codes : null;
}

let bundles: Promise<string[] | null> | null = null;

/**
 * The app bundles' code. The text is large (about 24 MB), so the plugin keeps it only for lookups that start
 * at about the same time (`SHARE_MS`); the lookups keep their small results.
 */
function bundleCode(): Promise<string[] | null> {
  if (!bundles) {
    const loading = loadBundles();
    bundles = loading;
    void loading.finally(() =>
      setTimeout(() => {
        if (bundles === loading) bundles = null;
      }, SHARE_MS),
    );
  }
  return bundles;
}

/** Loads the app module whose code contains `marker`. Metro ends each module with `},<id>,[<dependencies>]);`. */
async function findAppModule<T>(marker: string, pick: (module: unknown) => T | null): Promise<T | null> {
  const metroRequire = (globalThis as { __r?: MetroRequire }).__r;
  if (Platform.OS !== "web" || typeof metroRequire !== "function") return null;
  for (const code of (await bundleCode()) ?? []) {
    try {
      const at = code.indexOf(marker);
      if (at < 0) continue;
      const moduleId = /\},(\d+),\[[\d,]*\]\);/.exec(code.slice(at))?.[1];
      if (!moduleId) continue;
      const found = pick(metroRequire(Number(moduleId)));
      if (found !== null) return found;
    } catch {
      // Try the next bundle.
    }
  }
  return null;
}

/**
 * A lookup of one app export: `pick(module)` of the module whose code contains `marker`. The lookup runs at
 * the first call and keeps its answer; after a failure, a later call tries again. Null on native.
 */
export function appModule<T>(marker: string, pick: (module: unknown) => T | null): () => Promise<T | null> {
  return retrying(() => withTimeout(findAppModule(marker, pick), LOOKUP_TIMEOUT_MS, "").catch(() => null));
}
