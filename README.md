# Agent Tabs for Paseo

[![CI](https://github.com/m190/paseo-agent-tabs/actions/workflows/ci.yml/badge.svg)](https://github.com/m190/paseo-agent-tabs/actions/workflows/ci.yml)

![Agent Tabs in the Paseo sidebar](assets/sidebar.png)

A [Paseo](https://paseo.sh) plugin that shows which Claude Code or Codex tab needs you, on every Paseo host, on desktop and on the phone.

Paseo's own lists show Paseo agents. Many people run Claude Code and Codex in plain terminal tabs instead. Agent Tabs lists those tabs, one row per tab, with a state symbol in the style of [herdr](https://github.com/herdrdev/herdr):

| Symbol | State |
| --- | --- |
| `×` | blocked: a question, a permission dialog, or Codex "Action Required" |
| `◐` | working, also while a background shell runs |
| `✓` | done, and you did not look at the tab yet |
| `○` | idle |
| `›` | a plain terminal, with no agent in it |

Exact states come from Paseo's agent hooks. An agent without hooks shows working while its title or screen shows work, and idle otherwise.

It shows in the left sidebar, on an "Agents" board screen, in a right-side panel, and behind a header button in every workspace. You can open a tab, start a new one from a Paseo terminal profile, or close one. In the "By project" sort, a click on a project name folds it: the project then shows its state counts and only its blocked and done tabs. The display menu folds or unfolds all projects. See [OVERVIEW.md](OVERVIEW.md) for a short tour.

![The agents board](assets/board.png)

![Agent Tabs on the phone](assets/phone.png)

The screenshots use demo projects and scripted agent screens.

## Install

```sh
paseo plugin add git:m190/paseo-agent-tabs
```

The plugin needs no `npm install`: Paseo builds it, and React, React Native and the Paseo packages come from the host.

Plugins must be on in `~/.paseo/config.json`: `"pluginsEnabled": true` at the top level. Then run `paseo daemon reload`.

With several hosts, install the plugin on each host. Every host then shows the tabs of all hosts in one list.

### Codex

Codex 0.167 and later runs its sessions in a shared `codex app-server` process by default. Its hooks then do not reach Paseo, and the plugin falls back to the Codex title and screen. Start Codex with `codex --no-daemon` in your Paseo terminal profile to get exact states.

## What it reads

- Terminal screens: every 2 seconds, the plugin server reads the last 120 rows of each Claude Code and Codex terminal. It looks at the bottom lines for background shells, dialogs and Codex's working line. While the board is open, it also reads the last lines of every terminal for the previews, every 3 seconds.
- Paseo's lists: terminals, agents, workspaces and projects from the daemon of each host.
- The app's script bundle (web and desktop): the plugin finds the app's navigation function and workspace layout store in it. On iOS and Android it opens a `paseo://` link and reads the app's saved layout and current route.

All of this stays between your Paseo daemons and your Paseo app. The plugin sends nothing to other services.

## How the states work

Terminal states come from Paseo's terminal agent hooks (`daemon.enableTerminalAgentHooks`). Claude Code shows blocked while its screen shows a question or a permission dialog, because its hooks still report working then. Agents without hooks, such as Codex, show working while their title has a spinner or their screen shows "Working (…)", and idle otherwise. They cannot show done.

## Known limits

- Paseo's own project list stays visible. A plugin cannot filter it.
- The app refreshes its terminal list of a project only while it shows that project. So a link to a new tab can show the old tab first. The plugin sends the link again after 1 and 2.5 seconds. The repeats stop when you open another tab or close the tab. On web and desktop, they also stop when you click, press a key, or go back.
- On a phone, a tab that you select in the app's tab bar less than 2.5 seconds after you open a row goes back to that row.
- On a phone, the app does not save its open sheets. While a sheet shows a tab, the highlight stays on the tab under the sheet.

## Compatibility

Tested with Paseo 0.15.x on macOS, Linux (Raspberry Pi), the web app, the desktop app, and the Android app. The manifest accepts Paseo 0.15.0 and later.

The public plugin API does not give everything this plugin needs yet. So it uses some Paseo internals, and a new Paseo version can break it:

- The terminal title and the agent activity come from Paseo's internal daemon client (`server/host-daemon.ts`). Its types are copied into that file, because Paseo cannot resolve the client package when it builds a plugin from Git.
- On web and desktop, a tab opens through the app's own navigation function, which the plugin finds in the app bundle (`client/navigation.ts`). On native apps it uses a `paseo://` link.
- The highlighted row follows the tab that the app shows (`client/app/`). On web and desktop, the plugin reads the app's workspace layout store, which it finds in the app bundle. On native apps, it reads the app's saved copy of that store and the app's current route. When these reads fail, the highlight is the last row you opened.

## Development

```sh
npm ci
npm run typecheck
npm test
paseo plugin add ./            # install from this directory
paseo plugin reload agent-tabs # after a change
```

The status rules are in `server/status.ts`, as pure functions with tests in `test/status.test.ts`.

## License

[MIT](LICENSE)
