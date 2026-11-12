See which Claude Code or Codex tab needs you. One row per tab, with a state symbol in the style of [herdr](https://github.com/herdrdev/herdr).

| | State |
| --- | --- |
| `×` | blocked: waits for your answer or permission |
| `◐` | working |
| `✓` | done, not seen yet |
| `○` | idle |
| `›` | plain terminal |

## Where it shows

- **Left sidebar**: the list of tabs. Click "Agents" to hide it.
- **Board**: all tabs as cards with a live preview. Open it with the grid icon.
- **Right panel**: the same list next to your work. Add it with "+" next to Files.
- **Header button**: the most urgent state of all tabs. On a phone, it is in the "..." menu.

## What you can do

- Click a row to open the tab.
- Sort by state (what needs you first) or by project. Click a project name to fold it. Blocked and done tabs stay visible in a folded project.
- Use "+" to start a new tab from a Paseo terminal profile.
- Close a tab with × (or a long press on a phone).
- Use the keyboard on the board: j/k, enter, 1-9, a/b/w/d/i, s.

With several hosts, install the plugin on each one. You then get one list of the tabs of all hosts.

## What it reads

- The last lines of each Claude Code and Codex terminal, to find the state. On the board, also the preview lines.
- Paseo's lists of terminals, agents and projects.
- The app's own navigation and selected tab, to open a tab and to highlight it.

Nothing leaves your Paseo daemons and apps.

## Limits

- Codex shows exact states only with `codex --no-daemon`. Without it, the plugin reads the Codex title and screen.
- The plugin uses some Paseo internals, so a new Paseo version can break it.

Details: [README](https://github.com/m190/paseo-agent-tabs#readme).
