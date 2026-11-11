import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** herdr's agent states: blocked needs you, done is finished and not seen yet. */
export const tabStatusSchema = z.enum(["blocked", "working", "done", "idle", "unknown"]);
export type TabStatus = z.infer<typeof tabStatusSchema>;

export const tabSchema = z.object({
  id: z.string(),
  kind: z.enum(["terminal", "agent"]),
  workspaceId: z.string(),
  title: z.string(),
  /** Short agent name: claude, codex, opencode, shell. */
  agent: z.string(),
  status: tabStatusSchema,
  /** Background work the agent shows in its footer, for example "1 shell". */
  detail: z.string().nullable(),
  /** Epoch ms when the plugin saw `status` start. */
  statusSince: z.number(),
});
export type Tab = z.infer<typeof tabSchema>;

export const workspaceInfoSchema = z.object({
  workspaceId: z.string(),
  projectName: z.string(),
  /** Paseo's key for the project's color square (its project "view key"). */
  colorKey: z.string(),
  /** Null when the workspace is the project's main checkout. */
  workspaceName: z.string().nullable(),
});
export type WorkspaceInfo = z.infer<typeof workspaceInfoSchema>;

export const tabGroupSchema = workspaceInfoSchema.extend({
  tabs: z.array(tabSchema),
});
export type TabGroup = z.infer<typeof tabGroupSchema>;

export const tabListSchema = z.object({
  /** The host's server id: the app runs one plugin copy per host and does not tell the copy its host. */
  serverId: z.string().nullable().catch(null),
  groups: z.array(tabGroupSchema),
  /** Every workspace, also those without tabs: for the header buttons and the new-tab picker. */
  workspaces: z.array(workspaceInfoSchema),
  /** Set when the last refresh failed; `groups` then holds the last good list. */
  error: z.string().nullable(),
});
export type TabList = z.infer<typeof tabListSchema>;

export const tabsRpc = defineRpc({
  name: "tabs.list",
  input: z.object({}),
  output: tabListSchema,
});

export const profileSchema = z.object({
  /** Null for a plain terminal with the default shell. */
  id: z.string().nullable(),
  name: z.string(),
  icon: z.string().nullable(),
  /** True when the profile can start with a first prompt. */
  takesPrompt: z.boolean(),
});
export type Profile = z.infer<typeof profileSchema>;

export const profilesRpc = defineRpc({
  name: "tabs.profiles",
  input: z.object({}),
  output: z.object({ profiles: z.array(profileSchema) }),
});

export const createTabRpc = defineRpc({
  name: "tabs.create",
  input: z.object({
    workspaceId: z.string(),
    profileId: z.string().nullable(),
    prompt: z.string().max(10_000),
  }),
  output: z.object({ terminalId: z.string(), workspaceId: z.string(), name: z.string() }),
});

/** Closes a tab as the app does: a terminal is stopped, an agent is archived. */
export const closeTabRpc = defineRpc({
  name: "tabs.close",
  input: z.object({ kind: z.enum(["terminal", "agent"]), id: z.string().min(1) }),
  output: z.object({ closed: z.boolean() }),
});

export const PREVIEW_BATCH = 40;

export const previewRpc = defineRpc({
  name: "tabs.preview",
  input: z.object({ terminalIds: z.array(z.string()).max(PREVIEW_BATCH), lines: z.number().int().min(1).max(30) }),
  /** Only terminals that could be read; the client keeps its last preview for the others. */
  output: z.object({ previews: z.record(z.string(), z.array(z.string())) }),
});
