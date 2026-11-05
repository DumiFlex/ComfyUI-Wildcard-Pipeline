/**
 * The live keymap a bookmark shortcut is checked against. Read on demand
 * (when the shortcut field opens or records), never cached, so a rebind in
 * ComfyUI's Settings › Keybinding shows up at once.
 *
 * What it can see: every command registered with ComfyUI (core, user
 * rebinds, other extensions' `keybindings`) through
 * `extensionManager.command.commands[].keybinding`, the effective binding
 * after the user's changes; other WP bookmarks; rgthree's Bookmark nodes in
 * the same workflow. What it can't: extensions that listen to `keydown`
 * themselves. Those are caught at press time instead (see `widgets/bookmark.ts`).
 */
import { comboToString, normalizeCombo, type KeyOwner } from "./bookmarks";
import { walkAllNodes, type LiteGraphLike } from "./graph";

interface ComboLike { key?: string; ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean }

interface CommandLike {
  id?: string;
  label?: string;
  source?: string;
  keybinding?: { combo?: ComboLike } | null;
}

export interface KeymapAppLike {
  graph?: unknown;
  extensionManager?: { command?: { commands?: readonly CommandLike[] } };
  extensions?: readonly { name?: string; keybindings?: readonly { commandId?: string; combo?: ComboLike }[] }[];
}

const RGTHREE_BOOKMARK = "Bookmark (rgthree)";

/** Who registered a command, as the user would know them. */
function sourceName(cmd: CommandLike): string {
  const s = cmd.source?.trim();
  if (!s || s === "System" || s === "Comfy") return "ComfyUI";
  return s;
}

/** Commands bound through ComfyUI's keybinding system. */
export function commandOwners(app: KeymapAppLike): KeyOwner[] {
  const out: KeyOwner[] = [];
  const commands = app.extensionManager?.command?.commands;
  if (commands?.length) {
    for (const cmd of commands) {
      const c = cmd.keybinding?.combo;
      if (!c?.key) continue;
      const combo = comboToString({ key: c.key, ctrl: c.ctrl, alt: c.alt, shift: c.shift, meta: c.meta });
      if (combo) out.push({ combo, label: cmd.label || cmd.id || "a command", source: sourceName(cmd) });
    }
    return out;
  }
  // Older frontends: no effective keymap, so read what extensions declared.
  for (const ext of app.extensions ?? []) {
    for (const kb of ext.keybindings ?? []) {
      const c = kb.combo;
      if (!c?.key) continue;
      const combo = comboToString({ key: c.key, ctrl: c.ctrl, alt: c.alt, shift: c.shift, meta: c.meta });
      if (combo) out.push({ combo, label: kb.commandId ?? "a command", source: ext.name ?? "an extension" });
    }
  }
  return out;
}

interface WidgetLike { name?: string; value?: unknown }
interface NodeLike { type?: string; title?: string; widgets?: WidgetLike[] }

/** rgthree's Bookmark nodes: a single key, Shift allowed. */
export function rgthreeOwners(root: LiteGraphLike | undefined): KeyOwner[] {
  if (!root) return [];
  const out: KeyOwner[] = [];
  for (const { node } of walkAllNodes(root)) {
    const n = node as unknown as NodeLike;
    if (n.type !== RGTHREE_BOOKMARK) continue;
    const key = n.widgets?.find((w) => w.name === "shortcut_key")?.value;
    if (typeof key !== "string" || !key.trim()) continue;
    const label = `jump to ${n.title || "a bookmark"}`;
    const combo = normalizeCombo(key);
    if (!combo) continue;
    // rgthree also fires with Shift held.
    out.push({ combo, label, source: "rgthree Bookmark" });
    if (!combo.includes("+")) out.push({ combo: `Shift+${combo}`, label, source: "rgthree Bookmark" });
  }
  return out;
}

/** Everyone holding a key: ComfyUI commands (ours included, once the user
 *  binds one), rgthree bookmarks and the WP bookmarks passed in. */
export function liveKeymap(app: KeymapAppLike, bookmarkOwners: readonly KeyOwner[]): KeyOwner[] {
  return [
    ...commandOwners(app),
    ...rgthreeOwners(app.graph as LiteGraphLike | undefined),
    ...bookmarkOwners,
  ];
}
