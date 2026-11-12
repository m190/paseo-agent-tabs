import { Icon, ScrollView } from "@getpaseo/plugin/client/ui";
import { Fragment, type ReactNode, useEffect, useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import type { Tab, TabStatus, WorkspaceInfo } from "../shared/tabs";
import {
  ATTENTION,
  type Combined,
  type Counts,
  countByStatus,
  total,
  formatAge,
  groupKey,
  groupLabel,
  type HostGroup,
  type HostInfo,
  type HostMode,
  isShell,
  listLayout,
  type SortMode,
  type WorkspaceTarget,
} from "./model";
import { useFolding } from "./folding";
import { useHostMode, useSort } from "./prefs";
import { closeTab, errorMessage } from "./close";
import { useCombined, useNow } from "./store";
import { projectColor, SHELL_SYMBOL, statusColor, SYMBOL, SYMBOL_SCALE, type Theme } from "./style";

/** A herdr state symbol. `shell` shows the terminal symbol for a tab without an agent. */
export function Glyph({ status, theme, size = 13, shell }: { status: TabStatus; theme: Theme; size?: number; shell?: boolean }) {
  return (
    <Text
      style={{
        color: statusColor(status, theme),
        fontSize: shell ? size : Math.round(size * SYMBOL_SCALE[status]),
        fontWeight: "700",
        width: Math.round(size * 1.15),
        textAlign: "center",
        lineHeight: Math.round(size * 1.35),
      }}
    >
      {shell ? SHELL_SYMBOL : SYMBOL[status]}
    </Text>
  );
}

/** The project's color square with its first letter, as in Paseo's own project list. */
export function ProjectBadge({ workspace, size = 16 }: { workspace: WorkspaceInfo; size?: number }) {
  const initial = (workspace.projectName.trim()[0] ?? "?").toUpperCase();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.25),
        backgroundColor: projectColor(workspace.colorKey),
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "#ffffff", fontSize: Math.round(size * 0.6), fontWeight: "700", lineHeight: size }}>{initial}</Text>
    </View>
  );
}

/** A small muted text button, for "board" and the sort mode. */
export function TextButton({ theme, label, accessibilityLabel, size = 11, onPress }: {
  theme: Theme;
  label: string;
  accessibilityLabel?: string;
  size?: number;
  onPress(): void;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} onPress={onPress} hitSlop={8}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: size }}>{label}</Text>
    </Pressable>
  );
}

/** True on a phone-sized window: controls get touch-sized targets there. */
export function usePhoneSize(): boolean {
  return useWindowDimensions().width < 600;
}

/** A 28-point square icon button, as in Paseo's own sidebar section headers. */
export function IconButton({ theme, icon, label, size = 14, active, onPress }: {
  theme: Theme;
  /** A Lucide icon name. */
  icon: string;
  label: string;
  size?: number;
  active?: boolean;
  onPress(): void;
}) {
  // 28 points with the same icon size on every screen, as Paseo's own section headers; a phone gets a bigger hit slop.
  const phone = usePhoneSize();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={phone ? 8 : 4}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        width: 28,
        height: 28,
        borderRadius: 6,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: active || pressed || hovered ? theme.colors.surface2 : "transparent",
      })}
    >
      <Icon name={icon} size={size} color={active ? theme.colors.foreground : theme.colors.foregroundMuted} />
    </Pressable>
  );
}

const SORT_ICON: Record<SortMode, string> = { spaces: "ListTree", priority: "ArrowDownWideNarrow" };
const SORT_TEXT: Record<SortMode, { label: string; help: string }> = {
  spaces: { label: "By project", help: "Tabs grouped under their project" },
  priority: { label: "By state", help: "Tabs that need you first" },
};

/** Radio rows with an icon, a label and a help line, for the display menu. */
function Choice<Mode extends string>({ theme, modes, value, icon, text, onChange, onChoose }: {
  theme: Theme;
  modes: readonly Mode[];
  value: Mode;
  icon: Record<Mode, string>;
  text: Record<Mode, { label: string; help: string }>;
  onChange(mode: Mode): void;
  onChoose?: () => void;
}) {
  const phone = usePhoneSize();
  return (
    <View>
      {modes.map((mode) => (
        <Pressable
          key={mode}
          accessibilityRole="radio"
          accessibilityState={{ checked: value === mode }}
          accessibilityLabel={text[mode].label}
          onPress={() => {
            onChange(mode);
            onChoose?.();
          }}
          style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            minHeight: phone ? 52 : undefined,
            paddingVertical: 7,
            paddingHorizontal: 10,
            borderRadius: 6,
            backgroundColor: pressed || hovered ? theme.colors.surface2 : "transparent",
          })}
        >
          <Icon name={icon[mode]} size={15} color={theme.colors.foregroundMuted} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.colors.foreground, fontSize: phone ? 14 : 13 }}>{text[mode].label}</Text>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: phone ? 12 : 11 }}>{text[mode].help}</Text>
          </View>
          <View style={{ width: 15 }}>{value === mode ? <Icon name="Check" size={15} color={theme.colors.accent} /> : null}</View>
        </Pressable>
      ))}
    </View>
  );
}

/** The sort modes as a list to choose from, for the display menu. */
export function SortChoice({ theme, onChoose }: { theme: Theme; onChoose?: () => void }) {
  const [sort, setSort] = useSort();
  return (
    <Choice theme={theme} modes={["spaces", "priority"]} value={sort} icon={SORT_ICON} text={SORT_TEXT} onChange={setSort} onChoose={onChoose} />
  );
}

const HOST_ICON: Record<HostMode, string> = { grouped: "Server", combined: "Rows3" };
const HOST_TEXT: Record<HostMode, { label: string; help: string }> = {
  grouped: { label: "Group by host", help: "A section for each computer" },
  combined: { label: "One list", help: "All computers together" },
};

/** How the lists show the tabs of several hosts, for the display menus. */
export function HostChoice({ theme, onChoose }: { theme: Theme; onChoose?: () => void }) {
  const [mode, setMode] = useHostMode();
  return (
    <Choice theme={theme} modes={["grouped", "combined"]} value={mode} icon={HOST_ICON} text={HOST_TEXT} onChange={setMode} onChoose={onChoose} />
  );
}

interface AgentRowProps {
  tab: Tab;
  group: HostGroup;
  theme: Theme;
  now: number;
  /** Show the project on line 2, when rows are not grouped by workspace. */
  showProject: boolean;
  /** Show the host on line 2, when there are several hosts. */
  showHost?: boolean;
  active: boolean;
  selected?: boolean;
  compact?: boolean;
  onPress(): void;
  /** Closes the tab. The row asks first: × (on hover, or always with `alwaysShowClose`) or a long press. */
  onClose?: () => Promise<void>;
  alwaysShowClose?: boolean;
}

/** A small text button for the close question in a row. */
function RowButton({ theme, label, danger, disabled, onPress }: { theme: Theme; label: string; danger?: boolean; disabled?: boolean; onPress(): void }) {
  const phone = usePhoneSize();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        paddingHorizontal: 10,
        paddingVertical: phone ? 8 : 3,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: danger ? statusColor("blocked", theme) : theme.colors.border,
        backgroundColor: pressed || hovered ? theme.colors.surface2 : "transparent",
        opacity: disabled ? 0.6 : 1,
      })}
    >
      <Text style={{ fontSize: phone ? 13 : 12, fontWeight: "600", color: danger ? statusColor("blocked", theme) : theme.colors.foreground }}>{label}</Text>
    </Pressable>
  );
}

/** How long "Closing…" stays when the list did not drop the tab yet. */
const CLOSING_MS = 8_000;

/** herdr's agent row: line 1 is the state symbol and the tab, line 2 the agent, the project and the host. */
export function AgentRow({ tab, group, theme, now, showProject, showHost, active, selected, compact, onPress, onClose, alwaysShowClose }: AgentRowProps) {
  const shell = isShell(tab);
  const [closing, setClosing] = useState<"ask" | "busy" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The × stays mounted and only shows on hover: a press resets the hover state, and an × that unmounts then
  // would lose its own click. Phones have no hover, so their rows use the long press and have no hidden ×.
  const [hovered, setHovered] = useState(false);
  const phone = usePhoneSize();
  const closeButton = Boolean(onClose) && !closing && (alwaysShowClose || !phone);
  useEffect(() => {
    if (closing !== "busy") return;
    const timer = setTimeout(() => setClosing(null), CLOSING_MS);
    return () => clearTimeout(timer);
  }, [closing]);
  const ask = () => {
    setError(null);
    setClosing("ask");
  };
  const cancel = () => {
    setError(null);
    setClosing(null);
  };
  const close = async () => {
    if (!onClose) return;
    setClosing("busy");
    try {
      await onClose();
    } catch (failure) {
      setError(errorMessage(failure));
      setClosing("ask");
    }
  };
  const working = tab.status === "working";
  const question = error ?? (working ? `${tab.agent} is working. Close anyway?` : shell ? "Close this terminal?" : "Close this tab?");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${tab.title}, ${shell ? "terminal" : `${tab.agent}, ${tab.status}`}`}
      accessibilityHint={onClose ? "Long press to close" : undefined}
      onPress={closing ? cancel : onPress}
      onLongPress={onClose && !closing ? ask : undefined}
      delayLongPress={450}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        paddingVertical: compact ? 8 : 5,
        paddingHorizontal: 8,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: closing ? statusColor("blocked", theme) : selected ? theme.colors.accent : active ? theme.colors.border : "transparent",
        backgroundColor: active ? theme.colors.surface2 : pressed || hovered ? theme.colors.surface1 : "transparent",
      })}
    >
      <>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Glyph status={tab.status} theme={theme} size={compact ? 15 : 13} shell={shell} />
          <Text
            numberOfLines={1}
            style={{ flex: 1, color: theme.colors.foreground, fontWeight: active ? "700" : "600", fontSize: compact ? 15 : 13 }}
          >
            {tab.title}
          </Text>
          {shell ? null : <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{formatAge(tab.statusSince, now)}</Text>}
          {closeButton ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Close ${tab.title}`}
              onPress={ask}
              hitSlop={8}
              style={{ paddingHorizontal: 2, opacity: alwaysShowClose || hovered ? 1 : 0 }}
            >
              <Icon name="X" size={compact ? 16 : 13} color={theme.colors.foregroundMuted} />
            </Pressable>
          ) : null}
        </View>
        {closing ? (
          // The close question takes the place of line 2.
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginLeft: compact ? 23 : 21, marginTop: 4 }}>
            <Text style={{ flexShrink: 1, fontSize: compact ? 13 : 12, color: error ? statusColor("blocked", theme) : theme.colors.foreground }}>
              {closing === "busy" ? "Closing…" : question}
            </Text>
            {closing === "ask" ? (
              <>
                <RowButton theme={theme} label={working ? "Stop and close" : "Close"} danger onPress={() => void close()} />
                <RowButton theme={theme} label="Cancel" onPress={cancel} />
              </>
            ) : null}
          </View>
        ) : (
          /* Line 2: what, in which project, on which host. The symbol and its color give the state. The project
             and the host give way first, so the background work ("1 shell") stays visible. */
          <View style={{ flexDirection: "row", marginLeft: compact ? 23 : 21 }}>
            <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: compact ? 13 : 12, color: theme.colors.foregroundMuted }}>
              {shell ? "terminal" : tab.agent}
              {showProject ? ` · ${groupLabel(group)}` : ""}
              {showProject && showHost ? ` · ${group.hostLabel}` : ""}
            </Text>
            {!shell && tab.detail ? (
              <Text numberOfLines={1} style={{ flexShrink: 0, fontSize: compact ? 13 : 12, color: statusColor(tab.status, theme) }}>
                {/* Non-breaking spaces: web drops a normal space at the start of this text. */}
                {`\u00a0·\u00a0${tab.detail}`}
              </Text>
            ) : null}
          </View>
        )}
      </>
    </Pressable>
  );
}

/** The state counts that need attention, as herdr shows them: a symbol and a number for each state. */
function AttentionCounts({ counts, theme }: { counts: Counts; theme: Theme }) {
  return (
    <>
      {ATTENTION.map((status) =>
        counts[status] > 0 ? (
          <Text key={status} style={{ color: statusColor(status, theme), fontSize: 11, fontWeight: "700" }}>
            <Text style={{ fontSize: Math.round(11 * SYMBOL_SCALE[status]) }}>{SYMBOL[status]}</Text>
            {counts[status]}
          </Text>
        ) : null,
      )}
    </>
  );
}

export function GroupHeader({ group, theme, current, showHost, folded, onFold, onNew }: {
  group: HostGroup;
  theme: Theme;
  current: boolean;
  /** Shows the host after the project, when there are several hosts. */
  showHost?: boolean;
  /** The project shows only this header: it gets the state counts and the number of tabs. */
  folded?: boolean;
  /** Folds or unfolds the project. Without it, the header is not a button. */
  onFold?: () => void;
  /** Shows a "+" that opens a new tab in this workspace. */
  onNew?: (target: WorkspaceTarget) => void;
}) {
  const label = (
    <>
      <ProjectBadge workspace={group} size={14} />
      <Text
        numberOfLines={1}
        style={{ flexShrink: 1, fontSize: 11, fontWeight: "700", color: current ? theme.colors.foreground : theme.colors.foregroundMuted }}
      >
        {groupLabel(group)}
        {showHost ? <Text style={{ fontWeight: "400", color: theme.colors.foregroundMuted }}>{` · ${group.hostLabel}`}</Text> : null}
      </Text>
      {folded ? (
        <>
          <AttentionCounts counts={countByStatus([group])} theme={theme} />
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{group.tabs.length}</Text>
        </>
      ) : null}
      {onFold ? <Icon name={folded ? "ChevronRight" : "ChevronDown"} size={12} color={theme.colors.foregroundMuted} /> : null}
    </>
  );
  const row = { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 } as const;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingTop: 10, paddingBottom: 2 }}>
      {onFold ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${folded ? "Show" : "Hide"} the tabs of ${groupLabel(group)}`}
          accessibilityState={{ expanded: !folded }}
              onPress={onFold}
          hitSlop={6}
          style={row}
        >
          {label}
        </Pressable>
      ) : (
        <View style={row}>{label}</View>
      )}
      {onNew ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`New tab in ${groupLabel(group)}`}
          onPress={() => onNew({ serverId: group.serverId, workspaceId: group.workspaceId })}
          hitSlop={10}
          style={{ paddingHorizontal: 4 }}
        >
          <Icon name="Plus" size={14} color={theme.colors.foregroundMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** "Fold all" and "Unfold all" for the display menu, in the "By project" sort with two or more projects. */
function FoldChoice({ theme, onChoose }: { theme: Theme; onChoose?: () => void }) {
  const [sort] = useSort();
  const combined = useCombined();
  const { folded, ready, setAll } = useFolding(combined);
  const phone = usePhoneSize();
  if (!ready || sort !== "spaces" || combined.groups.length < 2) return null;
  const allFolded = combined.groups.every((group) => folded.has(groupKey(group)));
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        setAll(!allFolded);
        onChoose?.();
      }}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        minHeight: phone ? 44 : undefined,
        paddingVertical: 7,
        paddingHorizontal: 10,
        borderRadius: 6,
        backgroundColor: pressed || hovered ? theme.colors.surface2 : "transparent",
      })}
    >
      <Icon name={allFolded ? "ChevronsUpDown" : "ChevronsDownUp"} size={15} color={theme.colors.foregroundMuted} />
      <Text style={{ color: theme.colors.foreground, fontSize: phone ? 14 : 13 }}>{allFolded ? "Unfold all projects" : "Fold all projects"}</Text>
    </Pressable>
  );
}

/** A host's name with its state counts, above its tabs when the list is grouped by host. */
export function HostHeader({ host, groups, theme }: { host: HostInfo; groups: readonly HostGroup[]; theme: Theme }) {
  const counts = countByStatus(groups.filter((group) => group.serverId === host.serverId));
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingTop: 12 }}>
      <Icon name="Server" size={12} color={theme.colors.foregroundMuted} />
      <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 12, fontWeight: "600", color: theme.colors.foregroundMuted }}>
        {host.label}
      </Text>
      <AttentionCounts counts={counts} theme={theme} />
      {host.error ? (
        <Text accessibilityLabel={`Not updated: ${host.error}`} style={{ color: statusColor("blocked", theme), fontSize: 11 }}>
          offline
        </Text>
      ) : null}
    </View>
  );
}

interface TabRowsProps {
  combined: Pick<Combined, "groups" | "hosts" | "workspaces">;
  theme: Theme;
  compact: boolean;
  activeKey: string | null;
  /** The workspace the view belongs to: its group header is highlighted. */
  current?: WorkspaceTarget;
  onOpen(serverId: string, tab: Tab): void;
  /** Opens a new tab: in one workspace from its "+", or with a project choice from the empty list. */
  onNew?: (target?: WorkspaceTarget) => void;
}

/** The herdr agent rows of all hosts, grouped by workspace in "spaces" order, and by host when the setting says so. */
export function TabRows({ combined, theme, compact, activeKey, current, onOpen, onNew }: TabRowsProps) {
  const [sort] = useSort();
  const [hostMode] = useHostMode();
  const now = useNow();
  const { folded, ready, toggle } = useFolding(combined);
  const { sections, empty, showHost } = listLayout(combined.groups, combined.hosts, { sort, hostMode, folded, activeKey });
  if (empty && sections[0]?.host === null) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>No open tabs</Text>
        {onNew ? <TextButton theme={theme} label="+ New tab" size={13} onPress={() => onNew()} /> : null}
      </View>
    );
  }
  return (
    <>
      {sections.map((section) => (
        <Fragment key={section.host?.serverId ?? "all"}>
          {section.host ? <HostHeader host={section.host} groups={combined.groups} theme={theme} /> : null}
          {section.host && section.items.length === 0 ? (
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, paddingHorizontal: 8, paddingVertical: 6 }}>No open tabs</Text>
          ) : null}
          {section.items.map((item) => {
            if (item.kind === "header") {
              const { group } = item;
              const isCurrent = group.serverId === current?.serverId && group.workspaceId === current.workspaceId;
              return (
                <GroupHeader
                  key={item.key}
                  group={group}
                  theme={theme}
                  showHost={showHost}
                  current={item.holdsActive || isCurrent}
                  folded={item.folded}
                  onFold={ready ? () => toggle(group) : undefined}
                  onNew={onNew}
                />
              );
            }
            const { tab, group } = item.entry;
            return (
              <AgentRow
                key={item.key}
                tab={tab}
                group={group}
                theme={theme}
                now={now}
                showProject={sort === "priority"}
                showHost={showHost}
                active={activeKey === item.key}
                compact={compact}
                onPress={() => onOpen(group.serverId, tab)}
                onClose={() => closeTab(group.serverId, tab)}
              />
            );
          })}
        </Fragment>
      ))}
    </>
  );
}

/** The display choices: sort, and with several hosts the host grouping. For the display menus. */
export function DisplayOptions({ theme, manyHosts, onChoose }: { theme: Theme; manyHosts: boolean; onChoose?: () => void }) {
  const heading = (text: string) => (
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, paddingHorizontal: 10, paddingTop: 4, paddingBottom: 2 }}>{text}</Text>
  );
  return (
    <View style={{ gap: 2 }}>
      {heading("Sort")}
      <SortChoice theme={theme} onChoose={onChoose} />
      <FoldChoice theme={theme} onChoose={onChoose} />
      {manyHosts ? (
        <>
          {heading("Hosts")}
          <HostChoice theme={theme} onChoose={onChoose} />
        </>
      ) : null}
    </View>
  );
}

/**
 * A menu that floats over the content below its icon, for surfaces without a popover of the app. A tap
 * outside closes it. Put it last in a parent that covers the area, so it draws above the content.
 */
export function FloatingMenu({ theme, top, right, maxWidth, onClose, children }: {
  theme: Theme;
  top: number;
  right: number;
  /** The space there is; the menu is at most 320 wide. */
  maxWidth: number;
  onClose(): void;
  children: ReactNode;
}) {
  return (
    <>
      <Pressable accessibilityLabel="Close menu" onPress={onClose} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
      <View
        style={{
          position: "absolute",
          top,
          right,
          width: Math.min(320, Math.max(0, maxWidth)),
          padding: 6,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface1,
          shadowColor: "#000000",
          shadowOpacity: 0.3,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 8,
        }}
      >
        {children}
      </View>
    </>
  );
}

interface TabListViewProps extends TabRowsProps {
  /** With the error, so the panel and the popover say when the list is old, as the sidebar does. */
  combined: Pick<Combined, "groups" | "hosts" | "workspaces" | "error">;
  /** Extra buttons in the header, before the display menu. */
  header?: ReactNode;
  /** Set for a popover; a panel fills its space. */
  maxHeight?: number;
}

/** The herdr agent panel: a header with the state counts and the icons, then the scrolling rows. */
export function TabListView({ header, maxHeight, ...rows }: TabListViewProps) {
  const { theme, combined } = rows;
  const [display, setDisplay] = useState(false);
  const [width, setWidth] = useState(0);
  const counts = countByStatus(combined.groups);
  const phone = usePhoneSize();
  // With a list, an error only marks it as old; without one, the error is all there is to show.
  const { error } = combined;
  const errorOnly = Boolean(error) && combined.groups.length === 0;
  return (
    <View
      style={{ flex: maxHeight ? undefined : 1 }}
      onLayout={(event: { nativeEvent: { layout: { width: number } } }) => setWidth(event.nativeEvent.layout.width)}
    >
      {/* The surface already says "Agents" (panel tab, sheet title), so the header has the counts and the icons in one row. */}
      <View style={{ flexDirection: "row", alignItems: "center", height: phone ? 44 : 36, paddingLeft: 12, paddingRight: 4, gap: 6 }}>
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{`${total(counts)} tabs`}</Text>
          <AttentionCounts counts={counts} theme={theme} />
          {error && !errorOnly ? (
            <Text accessibilityLabel={`Not updated: ${error}`} style={{ color: statusColor("blocked", theme), fontSize: 11 }}>
              offline
            </Text>
          ) : null}
        </View>
        {header}
        <IconButton theme={theme} icon="Settings2" label="Display preferences" active={display} onPress={() => setDisplay(!display)} />
      </View>
      <ScrollView style={maxHeight ? { maxHeight } : { flex: 1 }} contentContainerStyle={{ paddingHorizontal: 4, paddingBottom: 8 }}>
        {errorOnly ? (
          <Text style={{ color: statusColor("blocked", theme), fontSize: 11, padding: 12 }}>{error}</Text>
        ) : (
          <TabRows {...rows} />
        )}
      </ScrollView>
      {display ? (
        <FloatingMenu theme={theme} top={phone ? 42 : 34} right={4} maxWidth={width - 8} onClose={() => setDisplay(false)}>
          <DisplayOptions theme={theme} manyHosts={combined.hosts.length > 1} onChoose={() => setDisplay(false)} />
        </FloatingMenu>
      ) : null}
    </View>
  );
}
