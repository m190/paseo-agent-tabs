Agent Tabs shows every open terminal and agent tab in the style of [herdr](https://github.com/herdrdev/herdr): one row per tab, with herdr's state symbols and the agent name.

With several hosts, install the plugin on each host. Every list then shows the tabs of all these hosts. The display menu (sliders icon) shows one list of all hosts (the default) or groups the tabs by host. The default sort is by state, so what needs you comes first on any computer. Line 2 of a row reads: agent · project · host. The symbol and its color give the state. A tap opens the tab on its own host. The sort and fold settings are saved on every host, so the list looks the same whichever host's screen is open.

## Where it shows

- Left sidebar: the herdr agent list, one row per tab. On a phone it shows about 4 rows; "View all N tabs" opens the board. Click the "Agents" title to fold it. The header icons are: + (new tab), the grid (board), and the sliders (display menu: the sort mode, by project or by state; with several hosts, also "Group by host" or "One list").
- Agents board (main window): open it with the grid icon or from the Command Center. The state filters, + and the display menu stay at the top while the cards scroll. It has filters by state, order by project or by state, and a live preview of the last lines of each tab. On desktop: j/k move, enter or 1-9 open, a/b/w/d/i filter, s changes the order.
- Agents panel (right sidebar): add it with "+" next to Files and Changes. It stays visible while you work in a tab.
- Header button in every workspace: one symbol for the most urgent state; a click opens the list. On phones it is in the "..." sheet.

## New tabs

Close a tab without opening it: on desktop, hover a row and click ×; on a phone, long-press the row; on the board, every card has ×. The row then asks once ("Stop and close" for a working agent). Closing does what the app's own close does: a terminal stops, an agent is archived.

The + icon opens a new tab: pick the project (also one without tabs; with several hosts, the projects show under their host), type a first prompt if you want, and pick the agent profile from Paseo's settings (Claude Code, Codex, and others) or a plain terminal. The "+" next to a project skips the project step. The new tab opens at once. The + icon is in the left sidebar, in the right panel, in the header button's list, and on the board.

## States

`×` blocked (needs input or permission), `◐` working, `✓` done and not seen yet, `○` idle, `·` unknown (a plain shell, or an agent without hooks). The colors are herdr's catppuccin colors.

Terminal states come from Paseo's terminal agent hooks (`daemon.enableTerminalAgentHooks`). Claude Code shows blocked while its screen shows a question or permission dialog, because its hooks still report working then. Agents without hooks, such as Codex, show working while their title has a spinner. Codex also shows working while its screen shows "Working (…)" or "Waiting for background terminal (…)" above the prompt.

## Limits

- Paseo's own project list stays visible. A plugin cannot filter it.
- On phones, Paseo puts plugin header buttons into the "..." sheet.
- The plugin asks the daemon for the tab list every 2 seconds, and for previews every 3 seconds while the board is open.
- The app keeps its own terminal list for each project and refreshes it only while it shows that project. A link to a tab that the app does not know yet opens the project, and then the app removes the tab again. So the plugin sends the link again after 1 and 2.5 seconds. The repeats stop when you open another tab.
