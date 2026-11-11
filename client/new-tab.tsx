import { Icon, ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import { Fragment, type ReactNode, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { errorMessage, withTimeout } from "../shared/async";
import { createTabRpc, type Profile, profilesRpc, type Tab } from "../shared/tabs";
import { sourceFor } from "./hub";
import { groupLabel, type HostWorkspace, type WorkspaceTarget } from "./model";
import { type Navigation, openTab } from "./navigation";
import { PROFILE_ICONS } from "./profile-icons";
import { ProjectBadge } from "./rows";
import { useCombined, waitForTerminal } from "./store";
import { statusColor, type Theme } from "./style";

const CREATE_TIMEOUT_MS = 15_000;
const NO_HOST = "This host is not connected";

/** The profile list changes rarely, but a change in Paseo's settings must show the next time the menu opens. */
const PROFILES_TTL_MS = 30_000;
const profileRequests = new Map<string, { request: Promise<Profile[]>; at: number }>();

function useProfiles(serverId: string | null): { profiles: Profile[] | null; error: string | null } {
  const [state, setState] = useState<{ profiles: Profile[] | null; error: string | null }>({ profiles: null, error: null });
  useEffect(() => {
    setState({ profiles: null, error: null });
    if (!serverId) return;
    let live = true;
    const cached = profileRequests.get(serverId);
    let request = cached && Date.now() - cached.at < PROFILES_TTL_MS ? cached.request : null;
    if (!request) {
      const source = sourceFor(serverId);
      request = source ? source.rpc(profilesRpc, {}).then((result) => result.profiles) : Promise.reject(new Error(NO_HOST));
      profileRequests.set(serverId, { request, at: Date.now() });
    }
    request.then(
      (profiles) => live && setState({ profiles, error: null }),
      (error: unknown) => {
        profileRequests.delete(serverId);
        if (live) setState({ profiles: null, error: errorMessage(error) });
      },
    );
    return () => {
      live = false;
    };
  }, [serverId]);
  return state;
}

/** Paseo's logo for a profile; a terminal or bot symbol when there is none. */
function profileIcon(profile: Profile): { svg: string } | string {
  const svg = profile.icon ? PROFILE_ICONS[profile.icon] : undefined;
  if (svg) return { svg };
  return profile.id === null ? "SquareTerminal" : "Bot";
}

function Row({ theme, label, icon, leading, detail, disabled, onPress }: {
  theme: Theme;
  label: string;
  /** Drawn instead of `icon`, for example a project square. */
  leading?: ReactNode;
  /** A Lucide icon name or inline SVG. */
  icon?: { svg: string } | string;
  detail?: string;
  disabled?: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 9,
        borderRadius: 6,
        opacity: disabled ? 0.5 : 1,
        backgroundColor: pressed || hovered ? theme.colors.surface2 : "transparent",
      })}
    >
      {leading || icon ? (
        <View style={{ width: 18, alignItems: "center" }}>
          {leading ?? (icon ? <Icon icon={icon} size={16} color={theme.colors.foreground} /> : null)}
        </View>
      ) : null}
      <Text numberOfLines={1} style={{ flex: 1, color: theme.colors.foreground, fontSize: 14 }}>
        {label}
      </Text>
      {detail ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{detail}</Text> : null}
    </Pressable>
  );
}

export interface NewTabMenuProps {
  theme: Theme;
  /** Preselects the project and its host (the computer that runs the tab); without it, the menu asks first. */
  target?: WorkspaceTarget;
  navigation?: Navigation;
  /** Called after the new tab opened. */
  close(): void;
  /** Shows a back button that leaves the menu, when the menu replaces a list in place. */
  onBack?: () => void;
}

/** Opens a new terminal tab: pick the project, optionally type a first prompt, pick the agent. */
export function NewTabMenu({ theme, target: preset, navigation, close, onBack }: NewTabMenuProps) {
  const { workspaces, groups, hosts } = useCombined();
  const [target, setTarget] = useState<WorkspaceTarget | null>(preset ?? null);
  const { profiles, error: profilesError } = useProfiles(target?.serverId ?? null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = (serverId: string, workspaceId: string) => `${serverId}/${workspaceId}`;
  const tabCounts = useMemo(() => new Map(groups.map((group) => [key(group.serverId, group.workspaceId), group.tabs.length])), [groups]);
  const workspace = target
    ? workspaces.find((candidate) => candidate.serverId === target.serverId && candidate.workspaceId === target.workspaceId)
    : undefined;
  const promptProfiles = profiles?.filter((profile) => profile.takesPrompt) ?? [];
  const manyHosts = hosts.length > 1;

  const start = async (profile: Profile) => {
    if (!target || busy) return;
    const { serverId, workspaceId } = target;
    setBusy(true);
    setError(null);
    try {
      const source = sourceFor(serverId);
      if (!source) throw new Error(NO_HOST);
      const created = await withTimeout(
        source.rpc(createTabRpc, { workspaceId, profileId: profile.id, prompt: profile.takesPrompt ? prompt : "" }),
        CREATE_TIMEOUT_MS,
        "The new tab did not start in time",
      );
      const tab: Tab = {
        id: created.terminalId,
        kind: "terminal",
        workspaceId: created.workspaceId,
        title: created.name,
        agent: profile.name.toLowerCase(),
        status: "unknown",
        detail: null,
        statusSince: Date.now(),
      };
      await waitForTerminal(serverId, created.terminalId);
      close();
      openTab(serverId, tab, navigation);
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  };

  // The host line says where the tab runs: the chosen project's host, or the only host.
  const hostLabel = workspace?.hostLabel ?? (manyHosts ? null : hosts[0]?.label);
  const heading = (text: string, back?: () => void) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8 }}>
      {back ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={back} hitSlop={8}>
          <Icon name="ChevronLeft" size={16} color={theme.colors.foregroundMuted} />
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "700", color: theme.colors.foreground }}>
          {text}
        </Text>
        {hostLabel ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
            <Icon name="Server" size={11} color={theme.colors.foregroundMuted} />
            <Text numberOfLines={1} style={{ fontSize: 11, color: theme.colors.foregroundMuted }}>
              {hostLabel}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );

  if (!workspace) {
    return (
      <View style={{ minWidth: 300 }}>
        {heading("New tab in…", onBack)}
        <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingHorizontal: 4, paddingBottom: 8 }}>
          {workspaces.length === 0 ? <Text style={{ color: theme.colors.foregroundMuted, padding: 12 }}>No projects</Text> : null}
          {workspaces.map((info: HostWorkspace, index) => {
            const count = tabCounts.get(key(info.serverId, info.workspaceId)) ?? 0;
            const firstOfHost = index === 0 || workspaces[index - 1]!.serverId !== info.serverId;
            return (
              <Fragment key={key(info.serverId, info.workspaceId)}>
                {manyHosts && firstOfHost ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 2 }}>
                    <Icon name="Server" size={12} color={theme.colors.foregroundMuted} />
                    <Text numberOfLines={1} style={{ fontSize: 11, color: theme.colors.foregroundMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      {info.hostLabel}
                    </Text>
                  </View>
                ) : null}
                <Row
                  theme={theme}
                  leading={<ProjectBadge workspace={info} size={18} />}
                  label={groupLabel(info)}
                  detail={count > 0 ? `${count} open` : undefined}
                  onPress={() => setTarget({ serverId: info.serverId, workspaceId: info.workspaceId })}
                />
              </Fragment>
            );
          })}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ minWidth: 300, paddingBottom: 8 }}>
      {heading(`New tab in ${groupLabel(workspace)}`, preset ? onBack : () => setTarget(null))}
      {promptProfiles.length > 0 ? (
        <View style={{ paddingHorizontal: 12, paddingBottom: 6 }}>
          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            placeholder="First prompt (optional)"
            placeholderTextColor={theme.colors.foregroundMuted}
            multiline
            editable={!busy}
            onSubmitEditing={() => promptProfiles[0] && void start(promptProfiles[0])}
            style={{
              minHeight: 40,
              maxHeight: 120,
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: 6,
              paddingHorizontal: 8,
              paddingVertical: 6,
              color: theme.colors.foreground,
              fontSize: 14,
            }}
          />
        </View>
      ) : null}
      {profilesError ? <Text style={{ color: statusColor("blocked", theme), paddingHorizontal: 12 }}>{profilesError}</Text> : null}
      {!profiles && !profilesError ? <Text style={{ color: theme.colors.foregroundMuted, paddingHorizontal: 12 }}>Loading…</Text> : null}
      <View style={{ paddingHorizontal: 4 }}>
        {profiles?.map((profile) => (
          <Row
            key={profile.id ?? "terminal"}
            theme={theme}
            icon={profileIcon(profile)}
            label={profile.name}
            detail={profile.takesPrompt && prompt.trim() ? "with prompt" : undefined}
            disabled={busy}
            onPress={() => void start(profile)}
          />
        ))}
      </View>
      {busy ? <Text style={{ color: theme.colors.foregroundMuted, paddingHorizontal: 12 }}>Starting…</Text> : null}
      {error ? <Text style={{ color: statusColor("blocked", theme), paddingHorizontal: 12 }}>{error}</Text> : null}
    </View>
  );
}
