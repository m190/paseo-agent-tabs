// The app's workspace route for one tab, built the way the app parses it. Pure, so tests can check it.

const SAFE_SEGMENT = /^[A-Za-z0-9._~-]+$/;
const ENCODED_PREFIX = "b64_";
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Spaces after the colon of an open value: the app trims them from the id. */
export const MAX_PADDING = 48;

function utf8(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return bytes;
}

function base64url(bytes: readonly number[]): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const [a = 0, b = 0, c = 0] = [bytes[index], bytes[index + 1], bytes[index + 2]];
    const chunk = (a << 16) | (b << 8) | c;
    const length = Math.min(3, bytes.length - index) + 1;
    for (let part = 0; part < length; part++) out += BASE64URL[(chunk >> (18 - 6 * part)) & 63];
  }
  return out;
}

/** The app's `encodeWorkspaceIdForPathSegment`: safe ids as they are, others as "b64_" + base64url. */
export function workspaceSegment(workspaceId: string): string {
  const id = workspaceId.trim();
  return SAFE_SEGMENT.test(id) ? id : `${ENCODED_PREFIX}${base64url(utf8(id))}`;
}

/** `/h/<server>/workspace/<workspace>?open=<kind>:<padding><id>`. */
export function tabRoute(serverId: string, tab: { kind: string; id: string; workspaceId: string }, padding = 0): string {
  const open = encodeURIComponent(`${tab.kind}:${" ".repeat(padding)}${tab.id}`);
  return `/h/${encodeURIComponent(serverId)}/workspace/${workspaceSegment(tab.workspaceId)}?open=${open}`;
}

/** A padding from 1 to MAX_PADDING that differs from the last one sent to the same workspace. */
export function nextPadding(last: number | undefined, random: () => number = Math.random): number {
  const pick = 1 + Math.floor(random() * (MAX_PADDING - 1));
  return last !== undefined && pick >= last ? pick + 1 : pick;
}
