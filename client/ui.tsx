import type {
  PluginButtonContentProps,
  PluginButtonIconProps,
  PluginPopoverProps,
  PluginSidebarItemProps,
  PluginWorkspacePanelProps,
} from "@getpaseo/plugin/client";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import type { Tab } from "../shared/tabs";
import { useActiveKey } from "./active-tab";
import { allTabs, ATTENTION, countByStatus, rollup, total, type WorkspaceTarget } from "./model";
import { type Navigation, openTab } from "./navigation";
import { NewTabMenu } from "./new-tab";
import { useCollapsed } from "./prefs";
import { DisplayOptions, Glyph, IconButton, TabListView, TabRows, usePhoneSize } from "./rows";
import { Icon, ScrollView } from "@getpaseo/plugin/client/ui";
import { useCombined } from "./store";
import { statusColor, SYMBOL, SYMBOL_SCALE, type Theme } from "./style";

export const BOARD_SCREEN_ID = "board";

/** Set by the entry file: popovers and panels get no `openScreen`. */
let openBoard: () => void = () => {};
export function setBoardOpener(open: () => void): void {
  openBoard = open;
}

function BoardButton({ theme, onPress }: { theme: Theme; onPress?: () => void }) {
  return <IconButton theme={theme} icon="LayoutGrid" label="Open the agents board" onPress={onPress ?? openBoard} />;
}

function NewButton({ theme, onPress }: { theme: Theme; onPress(): void }) {
  return <IconButton theme={theme} icon="Plus" label="New tab" size={15} onPress={onPress} />;
}

/** The sidebar's display menu, like Paseo's own "Display preferences". */
function DisplayMenu({ theme, close }: PluginPopoverProps) {
  const manyHosts = useCombined().hosts.length > 1;
  return (
    <View style={{ minWidth: 240, padding: 6 }}>
      <DisplayOptions theme={theme} manyHosts={manyHosts} onChoose={close} />
    </View>
  );
}

/**
 * The tab list, or the new-tab menu in its place. For surfaces that cannot open a popover of their own:
 * the right panel and the header button's popover.
 */
function ListOrNewTab({ theme, navigation, preset, close, list }: {
  theme: Theme;
  navigation?: Navigation;
  /** The workspace that "+ new" starts with. */
  preset?: WorkspaceTarget;
  /** Called after a new tab opened. */
  close?: () => void;
  list(openNew: (target?: WorkspaceTarget) => void): ReactNode;
}) {
  const [newTab, setNewTab] = useState<{ target?: WorkspaceTarget } | null>(null);
  if (!newTab) return <>{list((target) => setNewTab({ target: target ?? preset }))}</>;
  return (
    <NewTabMenu
      theme={theme}
      target={newTab.target}
      navigation={navigation}
      onBack={() => setNewTab(null)}
      close={() => {
        setNewTab(null);
        close?.();
      }}
    />
  );
}

// ---------- Left sidebar: the herdr agent list ----------

export function AgentsSidebar({ theme, host, layout, openScreen, openPopover }: PluginSidebarItemProps) {
  // The tabs of every host with the plugin, whichever host's copy the app shows here.
  const combined = useCombined();
  const { groups, error, loaded } = combined;
  const activeKey = useActiveKey();
  const [collapsed, setCollapsed] = useCollapsed();
  // Paseo's sidebar header does not scroll, so the list scrolls inside a part of the window height. On a
  // phone about 4 rows, so Paseo's own Workspaces list stays in view; "View all" opens the board.
  const phone = usePhoneSize();
  const windowHeight = useWindowDimensions().height;
  const maxListHeight = phone ? Math.min(240, Math.round(windowHeight * 0.3)) : Math.max(160, Math.round(windowHeight * 0.45));
  const [listHeight, setListHeight] = useState(0);
  const overflows = listHeight > maxListHeight + 1;
  const counts = useMemo(() => countByStatus(groups), [groups]);
  const onOpen = useCallback((serverId: string, tab: Tab) => openTab(serverId, tab), []);
  const onNew = useCallback(
    (target?: WorkspaceTarget) =>
      openPopover(({ theme: popoverTheme, close }: PluginPopoverProps) => (
        <NewTabMenu theme={popoverTheme} target={target} close={close} />
      )),
    [openPopover],
  );
  // With a list, an error only marks it as old; without one, the error is all there is to show.
  const errorOnly = Boolean(error) && groups.length === 0;
  return (
    <View style={{ paddingHorizontal: 4, paddingBottom: collapsed ? 0 : 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", height: phone ? 44 : 36, paddingLeft: 12, paddingRight: 8, gap: 2 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={collapsed ? "Show agents" : "Hide agents"}
          onPress={() => setCollapsed(!collapsed)}
          style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6, height: 28 }}
        >
          <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 12, color: theme.colors.foregroundMuted }}>
            Agents
          </Text>
          {ATTENTION.map((key) =>
            counts[key] > 0 ? (
              <Text key={key} style={{ color: statusColor(key, theme), fontSize: 11, fontWeight: "700" }}>
                <Text style={{ fontSize: Math.round(11 * SYMBOL_SCALE[key]) }}>{SYMBOL[key]}</Text>
                {counts[key]}
              </Text>
            ) : null,
          )}
          {collapsed ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{total(counts)}</Text> : null}
          {error && !errorOnly ? (
            <Text accessibilityLabel={`Not updated: ${error}`} style={{ color: statusColor("blocked", theme), fontSize: 11 }}>
              offline
            </Text>
          ) : null}
          <Icon name={collapsed ? "ChevronRight" : "ChevronDown"} size={12} color={theme.colors.foregroundMuted} />
        </Pressable>
        <NewButton theme={theme} onPress={() => onNew()} />
        <BoardButton theme={theme} onPress={() => openScreen({ screenId: BOARD_SCREEN_ID })} />
        <IconButton theme={theme} icon="Settings2" label="Display preferences" onPress={() => openPopover(DisplayMenu)} />
      </View>
      {collapsed || !loaded ? null : errorOnly ? (
        <Text style={{ color: statusColor("blocked", theme), fontSize: 11, paddingHorizontal: 12 }}>{error}</Text>
      ) : (
        <>
          <ScrollView
            style={{ maxHeight: maxListHeight }}
            nestedScrollEnabled
            onContentSizeChange={(_width: number, height: number) => setListHeight(height)}
          >
            <TabRows combined={combined} theme={theme} compact={layout.compact} activeKey={activeKey} onOpen={onOpen} onNew={onNew} />
          </ScrollView>
          {/* The list scrolls; this says that there is more and opens all tabs. */}
          {overflows ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => openScreen({ screenId: BOARD_SCREEN_ID })}
              style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingTop: 6, minHeight: phone ? 40 : 24 }}
            >
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{`View all ${total(counts)} tabs`}</Text>
              <Icon name="ChevronRight" size={12} color={theme.colors.foregroundMuted} />
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  );
}

// ---------- Right sidebar panel: the same list, visible while working in a tab ----------

export function AgentsPanel({ theme, host, layout, navigation, workspaceId }: PluginWorkspacePanelProps) {
  const combined = useCombined();
  const activeKey = useActiveKey();
  const current = { serverId: host.id, workspaceId };
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <ListOrNewTab
        theme={theme}
        navigation={navigation}
        preset={current}
        list={(openNew) => (
          <TabListView
            combined={combined}
            theme={theme}
            compact={layout.compact}
            activeKey={activeKey}
            current={current}
            onOpen={(serverId, tab) => openTab(serverId, tab, navigation)}
            onNew={openNew}
            header={
              <>
                <NewButton theme={theme} onPress={() => openNew()} />
                <BoardButton theme={theme} />
              </>
            }
          />
        )}
      />
    </View>
  );
}

// ---------- Header button: "..." sheet on phones, header icon on desktop ----------

export function AgentsPopover({ theme, host, layout, close, workspaceId }: PluginButtonContentProps) {
  const combined = useCombined();
  const activeKey = useActiveKey();
  const current = { serverId: host.id, workspaceId };
  return (
    <View style={{ minWidth: 340 }}>
      <ListOrNewTab
        theme={theme}
        preset={current}
        close={close}
        list={(openNew) => (
          <TabListView
            combined={combined}
            theme={theme}
            compact={layout.compact}
            activeKey={activeKey}
            current={current}
            maxHeight={layout.compact ? 560 : 520}
            onOpen={(serverId, tab) => {
              close();
              openTab(serverId, tab);
            }}
            onNew={openNew}
            header={
              <>
                <NewButton theme={theme} onPress={() => openNew()} />
                <BoardButton
                  theme={theme}
                  onPress={() => {
                    close();
                    openBoard();
                  }}
                />
              </>
            }
          />
        )}
      />
    </View>
  );
}

// The host draws the icon in a square of about 16 points: one symbol for the most urgent state of all hosts.
export function AgentsSummaryIcon({ theme, size }: PluginButtonIconProps) {
  const { groups } = useCombined();
  const status = useMemo(() => rollup(allTabs(groups)), [groups]);
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Glyph status={status} theme={theme} size={Math.max(12, Math.round(size * 0.85))} />
    </View>
  );
}
