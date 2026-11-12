import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** How the lists look. The daemon stores it, so it survives app restarts and is the same on every device. */
export const viewSchema = z.object({
  sort: z.enum(["spaces", "priority"]).catch("priority"),
  collapsed: z.boolean().catch(false),
  /** With several hosts: a section for each host, or one list with the host on each project. */
  hosts: z.enum(["grouped", "combined"]).catch("combined"),
  /** The folded projects of the "By project" sort, as `serverId/workspaceId`: they show only their header. */
  folded: z.array(z.string()).catch([]),
  /** Preview lines on the board: "auto" gives fewer lines when there are more cards; "off" reads no screens. */
  preview: z.enum(["off", "4", "8", "16", "auto"]).catch("auto"),
});
export type View = z.output<typeof viewSchema>;

/** By default one list of all hosts by state: what needs you first, on any host. */
export const DEFAULT_VIEW: View = { sort: "priority", collapsed: false, hosts: "combined", folded: [], preview: "auto" };

export const VIEW_SETTINGS = defineSettings({
  id: "view",
  scope: "host",
  version: 1,
  schema: viewSchema,
});
