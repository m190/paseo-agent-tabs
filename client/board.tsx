import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { withTimeout } from "../shared/async";
import { PREVIEW_BATCH, previewRpc, type TabStatus } from "../shared/tabs";
import { useActiveKey } from "./active-tab";
import { closeTab } from "./close";
import { sourceFor } from "./hub";
import { agentCounts, countByStatus, entryKey, autoPreviewLines, formatAge, listLayout, previewLines, PRIORITY, type TabEntry, tabKey, targetKey, total, type WorkspaceTarget } from "./model";
import { openTab } from "./navigation";
import { useHostMode, usePreviewSize, useSort } from "./prefs";
import { NewTabMenu } from "./new-tab";
import { AgentRow, DisplayOptions, FloatingMenu, GroupHeader, HostHeader, IconButton } from "./rows";
import { useFolding } from "./folding";
import { useCombined, useNow } from "./store";
import { statusColor, SYMBOL, SYMBOL_SCALE, type Theme } from "./style";
import { RouteAnchor } from "./app/route";

// This plugin typechecks without the DOM library. Declare only what this module uses.
interface KeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  target: unknown;
  preventDefault(): void;
  stopPropagation(): void;
}
declare const window: {
  addEventListener(type: "keydown", listener: (event: KeyEvent) => void, capture: boolean): void;
  removeEventListener(type: "keydown", listener: (event: KeyEvent) => void, capture: boolean): void;
};

const PREVIEW_MS = 3_000;
/** A preview older than this did not update several times in a row: it is marked as old. */
const STALE_MS = 15_000;
const PREVIEW_TIMEOUT_MS = 8_000;
const FILTER_KEYS: Record<string, TabStatus | null> = { a: null, b: "blocked", w: "working", d: "done", i: "idle", u: "unknown" };
const MONOSPACE = Platform.select({ ios: "Menlo", android: "monospace", default: "ui-monospace, Menlo, monospace" });

function isTyping(target: unknown): boolean {
  const element = target as { tagName?: string; isContentEditable?: boolean } | null;
  const tag = element?.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || element?.isContentEditable === true;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

/**
 * The last lines of each terminal, keyed by `tabKey`. Each host's plugin server reads its own terminals,
 * in batches the RPC accepts. A failed read keeps the last preview.
 */
interface PreviewState {
  lines: string[];
  /** Epoch ms of the last successful read. */
  at: number;
}

const NO_ENTRIES: readonly TabEntry[] = [];

function usePreviews(entries: readonly TabEntry[], lines: number): Record<string, PreviewState> {
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({});
  // "server terminal" pairs as one string, so the effect restarts only when the set of terminals changes.
  const wanted = entries
    .filter((entry) => entry.tab.kind === "terminal")
    .map((entry) => `${entry.group.serverId} ${entry.tab.id}`)
    .join("\n");
  useEffect(() => {
    const byHost = new Map<string, string[]>();
    const keep = new Set<string>();
    for (const pair of wanted ? wanted.split("\n") : []) {
      const [serverId, id] = pair.split(" ") as [string, string];
      byHost.set(serverId, [...(byHost.get(serverId) ?? []), id]);
      keep.add(tabKey(serverId, { kind: "terminal", id }));
    }
    // Forget the screens of closed tabs, so a board that stays open does not keep them all.
    setPreviews((previous) => {
      const kept = Object.entries(previous).filter(([key]) => keep.has(key));
      return kept.length === Object.keys(previous).length ? previous : Object.fromEntries(kept);
    });
    if (!wanted) return;
    let stopped = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    // One loop per host, so a slow host does not hold back the previews of the others.
    const loop = async (serverId: string, ids: string[]) => {
      for (const batch of chunks(ids, PREVIEW_BATCH)) {
        try {
          const source = sourceFor(serverId);
          if (!source) break;
          const result = await withTimeout(source.rpc(previewRpc, { terminalIds: batch, lines }), PREVIEW_TIMEOUT_MS, "Preview timed out");
          const at = Date.now();
          const keyed = Object.fromEntries(
            Object.entries(result.previews).map(([id, text]) => [tabKey(serverId, { kind: "terminal", id }), { lines: text, at }]),
          );
          if (!stopped) setPreviews((previous) => ({ ...previous, ...keyed }));
        } catch {
          // Keep the last previews of this batch.
        }
        if (stopped) return;
      }
      const timer = setTimeout(() => {
        timers.delete(timer);
        void loop(serverId, ids);
      }, PREVIEW_MS);
      timers.add(timer);
    };
    for (const [serverId, ids] of byHost) void loop(serverId, ids);
    return () => {
      stopped = true;
      for (const timer of timers) clearTimeout(timer);
    };
  }, [wanted, lines]);
  return previews;
}

function Chip({ theme, label, count, active, color, onPress, symbol, symbolScale = 1, large }: {
  theme: Theme;
  /** A bigger touch target, for phones. */
  large?: boolean;
  label: string;
  count: number;
  active: boolean;
  color?: string;
  symbol?: string;
  symbolScale?: number;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: large ? 12 : 10,
        paddingVertical: large ? 10 : 4,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? theme.colors.foreground : theme.colors.border,
        backgroundColor: active ? theme.colors.surface2 : "transparent",
      }}
    >
      <Text style={{ color: color ?? theme.colors.foreground, fontSize: 12, fontWeight: "700" }}>
        {symbol ? <Text style={{ fontSize: Math.round(12 * symbolScale) }}>{`${symbol} `}</Text> : null}
        {label}
      </Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{count}</Text>
    </Pressable>
  );
}

function Preview({ preview, now, theme, compact }: { preview: PreviewState | undefined; now: number; theme: Theme; compact: boolean }) {
  if (!preview || preview.lines.length === 0) return null;
  const stale = now - preview.at > STALE_MS;
  return (
    <View style={{ marginTop: 6, marginLeft: compact ? 0 : 21, padding: 8, borderRadius: 6, backgroundColor: theme.colors.surface1, overflow: "hidden" }}>
      {stale ? (
        <Text style={{ fontSize: 11, color: statusColor("blocked", theme), marginBottom: 4 }}>{`Not updated for ${formatAge(preview.at, now)}`}</Text>
      ) : null}
      {preview.lines.map((line, index) => (
        <Text key={index} numberOfLines={1} style={{ fontFamily: MONOSPACE, fontSize: 11, lineHeight: 15, color: theme.colors.foregroundMuted, opacity: stale ? 0.6 : 1 }}>
          {line || " "}
        </Text>
      ))}
    </View>
  );
}

export function BoardScreen({ theme, layout, navigation }: PluginScreenProps) {
  const combined = useCombined();
  const { groups, hosts, error } = combined;
  const { folded, ready: foldReady, toggle } = useFolding(combined);
  const [sort, setSort] = useSort();
  const [hostMode] = useHostMode();
  const [filter, setFilter] = useState<TabStatus | null>(null);
  /** The display menu (sort and hosts), open below the toolbar. */
  const [display, setDisplay] = useState(false);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  /** Null: no new-tab menu; otherwise the workspace it starts with (undefined: ask). */
  const [newTab, setNewTab] = useState<{ target?: WorkspaceTarget } | null>(null);
  // Every 5 s: the ages and the "not updated" marks of the previews.
  const now = useNow(5_000);
  const activeKey = useActiveKey();
  const compact = layout.compact;
  const keyboard = !compact && Platform.OS === "web";
  const { sections, rows: entries, empty, showHost } = useMemo(
    () => listLayout(groups, hosts, { sort, hostMode, filter, folded, activeKey }),
    [groups, hosts, sort, hostMode, filter, folded, activeKey],
  );
  const counts = useMemo(() => countByStatus(groups), [groups]);
  // The filter chips leave out plain shells, so "unknown" shows only for agents without a known state.
  const chipCounts = useMemo(() => agentCounts(groups), [groups]);
  const columns = compact ? 1 : width >= 1180 ? 3 : width >= 760 ? 2 : 1;
  const [previewSetting] = usePreviewSize();
  const lines = previewLines(previewSetting, autoPreviewLines(entries.length, columns));
  // Without a preview the board reads no terminal screens.
  const previews = usePreviews(lines > 0 ? entries : NO_ENTRIES, Math.max(1, lines));
  // The selection follows its tab when the list changes; it falls back to the first tab.
  const selectedIndex = Math.max(0, entries.findIndex((entry) => entryKey(entry) === selectedKey));
  const cardWidth: `${number}%` = columns === 1 ? "100%" : `${Math.floor(100 / columns) - 1}%`;

  const open = (entry: TabEntry) => openTab(entry.group.serverId, entry.tab, navigation);
  const chooseFilter = (next: TabStatus | null) => {
    setFilter(next);
    setSelectedKey(null);
  };

  // The key handler is added once and reads the current values from this ref.
  const latest = useRef({ entries, selectedIndex, sort, open, chooseFilter, setSort });
  latest.current = { entries, selectedIndex, sort, open, chooseFilter, setSort };
  useEffect(() => {
    if (!keyboard) return;
    const onKey = (event: KeyEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      const current = latest.current;
      const select = (index: number) => {
        const entry = current.entries[Math.min(Math.max(index, 0), current.entries.length - 1)];
        if (entry) setSelectedKey(entryKey(entry));
      };
      const key = event.key;
      if (key in FILTER_KEYS) current.chooseFilter(FILTER_KEYS[key] ?? null);
      else if (key === "s") current.setSort(current.sort === "spaces" ? "priority" : "spaces");
      else if (key === "j" || key === "ArrowDown") select(current.selectedIndex + 1);
      else if (key === "k" || key === "ArrowUp") select(current.selectedIndex - 1);
      else if (key === "Enter" && current.entries[current.selectedIndex]) current.open(current.entries[current.selectedIndex]!);
      else if (/^[1-9]$/.test(key) && current.entries[Number(key) - 1]) current.open(current.entries[Number(key) - 1]!);
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    // Capture phase: the board gets its keys before a focused button (for example Enter on "board").
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [keyboard]);

  const padding = compact ? 12 : 24;
  const closeDisplay = () => setDisplay(false);
  return (
    <View
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      onLayout={(event: { nativeEvent: { layout: { width: number } } }) => setWidth(event.nativeEvent.layout.width)}
    >
      <RouteAnchor />
      {/* The filters and the icons stay at the top; only the cards scroll. The host's screen header already says "Agents". */}
      <View
        style={{ paddingHorizontal: padding, paddingTop: compact ? 6 : 16, paddingBottom: 10, gap: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}
        onLayout={(event: { nativeEvent: { layout: { height: number } } }) => setToolbarHeight(event.nativeEvent.layout.height)}
      >
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 4 }}>
          {/* The chips go to a second line when the row is full, so the icons never cover them. */}
          <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            <Chip theme={theme} large={compact} label="all" count={total(counts)} active={filter === null} onPress={() => chooseFilter(null)} />
            {/* A state without tabs gets no chip, unless it is the current filter. */}
            {PRIORITY.filter((status) => chipCounts[status] > 0 || filter === status).map((status) => (
              <Chip
                key={status}
                theme={theme}
                large={compact}
                symbol={SYMBOL[status]}
                symbolScale={SYMBOL_SCALE[status]}
                label={status}
                count={chipCounts[status]}
                color={statusColor(status, theme)}
                active={filter === status}
                onPress={() => chooseFilter(filter === status ? null : status)}
              />
            ))}
          </View>
          <View style={{ flexDirection: "row", gap: 2 }}>
            <IconButton
              theme={theme}
              icon="Plus"
              size={16}
              label="New tab"
              active={newTab !== null}
              onPress={() => {
                closeDisplay();
                setNewTab(newTab ? null : {});
              }}
            />
            <IconButton theme={theme} icon="Settings2" label="Display preferences" active={display} onPress={() => setDisplay(!display)} />
          </View>
        </View>
        {keyboard ? (
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>j/k move · enter open · 1-9 open · a/b/w/d/i filter · s sort</Text>
        ) : null}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding, gap: compact ? 10 : 12 }}>
        {newTab ? (
          <View style={{ borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, maxWidth: 520 }}>
            <NewTabMenu
              key={targetKey(newTab.target)}
              theme={theme}
              target={newTab.target}
              navigation={navigation}
              onBack={() => setNewTab(null)}
              close={() => setNewTab(null)}
            />
          </View>
        ) : null}

        {error ? <Text style={{ color: statusColor("blocked", theme) }}>{groups.length > 0 ? `Not updated: ${error}` : error}</Text> : null}
        {empty && !error ? (
          <Text style={{ color: theme.colors.foregroundMuted }}>{filter ? `No ${filter} agents` : "No open tabs"}</Text>
        ) : null}

        {sections.map((section) => (
          <View key={section.host?.serverId ?? "all"} style={{ gap: compact ? 8 : 12 }}>
            {section.host ? (
              <View style={{ marginBottom: -6 }}>
                <HostHeader host={section.host} groups={groups} theme={theme} />
              </View>
            ) : null}
            {section.host && section.items.length === 0 ? (
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, paddingHorizontal: 8 }}>No open tabs</Text>
            ) : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: compact ? 8 : 12 }}>
              {section.items.map((item) => {
                if (item.kind === "header") {
                  const { group } = item;
                  return (
                    <View key={item.key} style={{ width: "100%", marginBottom: -6 }}>
                      <GroupHeader
                        group={group}
                        theme={theme}
                        current={item.holdsActive}
                        showHost={showHost}
                        folded={item.folded}
                        onFold={foldReady ? () => toggle(group) : undefined}
                        onNew={(target) => setNewTab({ target })}
                      />
                    </View>
                  );
                }
                const { entry, key } = item;
                const { tab, group } = entry;
                return (
                  // The keyboard selection outlines the whole card.
                  <View
                    key={key}
                    style={{
                      width: cardWidth,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: keyboard && entries[selectedIndex] === entry ? theme.colors.accent : theme.colors.border,
                      padding: 6,
                    }}
                  >
                    <AgentRow
                      tab={tab}
                      group={group}
                      theme={theme}
                      now={now}
                      showProject={sort === "priority"}
                      showHost={showHost}
                      active={activeKey === key}
                      compact={compact}
                      onPress={() => open(entry)}
                      onClose={() => closeTab(group.serverId, tab)}
                      alwaysShowClose
                    />
                    {lines > 0 ? (
                      <Pressable onPress={() => open(entry)} accessibilityLabel={`Open ${tab.title}`}>
                        <Preview preview={previews[key]} now={now} theme={theme} compact={compact} />
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>

      {/* The display menu floats over the cards, under its icon. */}
      {display ? (
        <FloatingMenu theme={theme} top={toolbarHeight - 4} right={padding} maxWidth={width - 2 * padding} onClose={closeDisplay}>
          <DisplayOptions theme={theme} manyHosts={hosts.length > 1} preview onChoose={closeDisplay} />
        </FloatingMenu>
      ) : null}
    </View>
  );
}
