Agent Tabs shows every open terminal and agent tab in the style of [herdr](https://github.com/herdrdev/herdr): one row per tab, with herdr's state symbols and the agent name.

With several hosts, install the plugin on each host. Every list then shows the tabs of all these hosts. The display menu (sliders icon) shows one list of all hosts (the default) or groups the tabs by host. The default sort is by state, so what needs you comes first on any computer. Line 2 of a row reads: agent · project · host. The symbol and its color give the state. A tap opens the tab on its own host. A change of the sort or fold settings is also saved on the other hosts that are online, so the list looks the same whichever host's screen is open.

## Where it shows

- Left sidebar: the herdr agent list, one row per tab. On a phone it shows about 4 rows; "View all N tabs" opens the board. Click the "Agents" title to fold it. The header icons are: + (new tab), the grid (board), and the sliders (display menu: the sort mode, by project or by state; with several hosts, also "Group by host" or "One list").
- Agents board (main window): open it with the grid icon or from the Command Center. The state filters, + and the display menu stay at the top while the cards scroll. It has filters by state, order by project or by state, and a live preview of the last lines of each tab. On desktop: j/k move, enter or 1-9 open, a/b/w/d/i filter, s changes the order.
- Agents panel (right sidebar): add it with "+" next to Files and Changes. It stays visible while you work in a tab.
- Header button in every workspace: one symbol for the most urgent state; a click opens the list. On phones it is in the "..." sheet.

## New tabs

Close a tab without opening it: on desktop, hover a row and click ×; on a phone, long-press the row; on the board, every card has ×. The row then asks once ("Stop and close" for a working agent). Closing does what the app's own close does: a terminal stops, an agent is archived.

The + icon opens a new tab: pick the project (also one without tabs; with several hosts, the projects show under their host), type a first prompt if you want, and pick the agent profile from Paseo's settings (Claude Code, Codex, and others) or a plain terminal. The "+" next to a project skips the project step. The new tab opens at once. The + icon is in the left sidebar, in the right panel, in the header button's list, and on the board.

## States

`×` blocked (needs input or permission), `◐` working, `✓` done and not seen yet, `○` idle, `›` a plain terminal with no agent. The colors are herdr's catppuccin colors.

Terminal states come from Paseo's terminal agent hooks (`daemon.enableTerminalAgentHooks`). Claude Code shows blocked while its screen shows a question or permission dialog, because its hooks still report working then. Agents without hooks, such as Codex, show working while their title has a spinner, and idle otherwise; they cannot show done. Codex also shows working while its screen shows "Working (…)" or "Waiting for background terminal (…)" above the prompt.

## What it reads

- Terminal screens: to find the state, the plugin server reads the last 120 rows of each Claude Code and Codex terminal every 2 seconds and looks at the bottom lines (background shells, dialogs, Codex's working line). While the board is open, it also reads the last lines of every terminal for the previews, every 3 seconds.
- Paseo's lists: terminals, agents, workspaces and projects from the daemon of each host. The plugin uses the daemon client of the Paseo installation it runs in, because the plugin API does not give terminal titles and states yet.
- The app's script bundle (web and desktop): to open a tab without reloading the window, the plugin loads the app's own script from the Paseo server and finds the app's navigation function in it. On iOS and Android it opens a `paseo://` link instead.
- The app's selected tab: the highlighted row follows the tab that the app shows, also a tab you select in the app's own tab bar. On web and desktop, the plugin reads the app's workspace layout store (found in the same script bundle). On iOS and Android, it reads the app's saved copy of that store and the app's current route. The plugin only reads them and changes nothing.

All of this stays between your Paseo daemons and your Paseo app. The plugin sends nothing to other services. New tabs start the terminal profiles from Paseo's settings, with the prompt you type.

## Limits

- Paseo's own project list stays visible. A plugin cannot filter it.
- On phones, Paseo puts plugin header buttons into the "..." sheet.
- The app keeps its own terminal list for each project and refreshes it only while it shows that project. A link to a tab that the app does not know yet opens the project, and then the app removes the tab again. So the plugin sends the link again after 1 and 2.5 seconds. The repeats stop when you open another tab or close the tab. On web and desktop, they also stop when you click, press a key, or go back.
- On a phone, a tab that you select in the app's tab bar less than 2.5 seconds after you open a row goes back to that row (the repeats above).
- On a phone, the app does not save its open sheets. While a sheet shows a tab, the highlight stays on the tab under the sheet.
