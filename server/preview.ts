const SEPARATOR = /^\s*[─━═]{12,}\s*$/u;
const PROMPT = /^\s*[❯›>]/u;
/** Codex's prompt line. Shells rarely print "›", so it is safe to cut there. */
const CODEX_PROMPT = /^\s*›/u;
const SEARCH_LINES = 15;
/** Codex draws its prompt, a blank line and a status line at the bottom. */
const CODEX_SEARCH_LINES = 6;

function withoutTrailingBlanks(lines: readonly string[]): string[] {
  const body = lines.map((line) => line.replace(/\s+$/u, ""));
  while (body.length > 0 && body[body.length - 1] === "") body.pop();
  return body;
}

/**
 * Where the agent's input box starts, or -1.
 * - Claude Code draws the prompt between two separator lines. A shell that prints lines has no prompt between them.
 * - Codex draws a "›" prompt line above its status line.
 */
function inputBoxStart(lines: readonly string[]): number {
  const separators: number[] = [];
  for (let index = lines.length - 1; index >= Math.max(0, lines.length - SEARCH_LINES); index--) {
    if (SEPARATOR.test(lines[index] ?? "")) separators.push(index);
    if (separators.length === 2) break;
  }
  if (separators.length === 2) {
    const [bottom, top] = separators as [number, number];
    if (lines.slice(top + 1, bottom).some((line) => PROMPT.test(line))) return top;
  }
  for (let index = lines.length - 1; index >= Math.max(0, lines.length - CODEX_SEARCH_LINES); index--) {
    if (CODEX_PROMPT.test(lines[index] ?? "")) return index;
  }
  return -1;
}

/** The last `count` non-empty lines of a terminal, without an agent's input box and status bar. */
export function trimPreview(lines: readonly string[], count: number): string[] {
  // A tall terminal (for example after a phone resized it) ends with many empty rows.
  const screen = withoutTrailingBlanks(lines);
  const boxStart = inputBoxStart(screen);
  // Empty lines only take space in a small preview.
  return (boxStart >= 0 ? screen.slice(0, boxStart) : screen).filter((line) => line.trim() !== "").slice(-count);
}
