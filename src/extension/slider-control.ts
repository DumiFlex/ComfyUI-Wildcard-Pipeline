/**
 * WP Slider mute / bypass by value — frontend only, the run never sees it.
 *
 * A slider with levels (`SliderLevel`: value ranges read like its Words
 * ranges, each Run, Mute or Bypass) gets one input `ctl_<row id>` in front of
 * its row, like a WP Toggles toggle. What is wired there (a node, a WP Node
 * Group, through reroutes) takes the mode of the level the value is in. Each
 * level may also name canvas groups: they take that level's mode while the
 * value is in it and run otherwise. A node two sliders (or a slider and a
 * level's group twice) drive keeps the stronger mode: mute, then bypass.
 *
 * Built on WP Toggles' control (`toggle-control.ts`): the same targets,
 * modes, release rules and focus places.
 */
import {
  MODE_ALWAYS,
  MODE_BYPASS,
  MODE_NEVER,
  ctlInputName,
  releaseTargets,
  setMode,
  strongerMode,
  toggleTargets,
  type ControlState,
  type CtlNode,
} from "./toggle-control";
import type { ToggleControl } from "./toggles";
import { drivesNodes, hasSliderDot, levelFor, sliderRows, type SliderLevelMode, type SliderRow, type SlidersConfig } from "./sliders";

export function levelModeNumber(mode: SliderLevelMode | undefined): number {
  return mode === "mute" ? MODE_NEVER : mode === "bypass" ? MODE_BYPASS : MODE_ALWAYS;
}

/** The nodes wired into a slider's dot (never the node itself). */
export function dotTargets(node: CtlNode, s: SliderRow): CtlNode[] {
  return hasSliderDot(s) ? toggleTargets(node, s.id, [], true) : [];
}

/** The nodes of some canvas groups by title (never the node itself). */
export function groupTargets(node: CtlNode, groups: readonly string[]): CtlNode[] {
  return groups.length ? toggleTargets(node, "", groups, false) : [];
}

/** Every node one slider drives at some value, with the mode it wants now. */
export function sliderWants(node: CtlNode, s: SliderRow): Map<CtlNode, number> {
  const out = new Map<CtlNode, number>();
  if (!drivesNodes(s) && !(s.levels ?? []).some((l) => l.groups?.length)) return out;
  const now = levelFor(s);
  const want = (n: CtlNode, mode: number): void => {
    out.set(n, strongerMode(out.get(n), mode));
  };
  for (const n of dotTargets(node, s)) want(n, levelModeNumber(now?.mode));
  for (const level of s.levels ?? []) {
    const mode = level === now ? levelModeNumber(level.mode) : MODE_ALWAYS;
    for (const n of groupTargets(node, level.groups ?? [])) want(n, mode);
  }
  return out;
}

/** Row id → the nodes it drives right now (dot and every level's groups). */
export function sliderWiring(node: CtlNode, cfg: SlidersConfig): Map<string, CtlNode[]> {
  const out = new Map<string, CtlNode[]>();
  for (const s of sliderRows(cfg)) {
    const nodes = [...sliderWants(node, s).keys()];
    if (nodes.length) out.set(s.id, nodes);
  }
  return out;
}

/**
 * Bring every slider's targets in line with its value. `only` limits it to
 * some rows' targets, `onlyNodes` to some nodes. Returns how many nodes
 * changed. Two rows driving one node: the stronger mode wins.
 */
export function applySliderControl(
  node: CtlNode,
  cfg: SlidersConfig,
  only?: ReadonlySet<string>,
  onlyNodes?: ReadonlySet<CtlNode>,
): number {
  const wanted = new Map<CtlNode, number>();
  const touched = new Set<CtlNode>();
  for (const s of sliderRows(cfg)) {
    for (const [n, mode] of sliderWants(node, s)) {
      wanted.set(n, strongerMode(wanted.get(n), mode));
      if ((!only || only.has(s.id)) && (!onlyNodes || onlyNodes.has(n))) touched.add(n);
    }
  }
  let changed = 0;
  for (const n of touched) changed += setMode(n, wanted.get(n) ?? MODE_ALWAYS);
  return changed;
}

/** Let nodes a slider no longer drives run again, when they still have a
 *  mode it could have given them (a mode set by hand is left alone). */
export function releaseSliderTargets(targets: readonly CtlNode[]): number {
  return releaseTargets(targets, "mute") + releaseTargets(targets, "bypass");
}

/** The `ctl_*` inputs `cfg` wants on the node, in row order. */
export function wantedSliderCtlInputs(cfg: SlidersConfig): string[] {
  return sliderRows(cfg).filter(hasSliderDot).map((s) => ctlInputName(s.id));
}

/** Row icon state, as WP Toggles' icon takes it (`ToggleCtlButton.vue`):
 *  the mode it gives now (or, while it runs them, the mode a level would
 *  give), whether that is on now, and the tooltip. Null while the slider
 *  drives nothing (no muting or bypassing level, or nothing wired and no
 *  groups). */
export function sliderControlState(node: CtlNode, s: SliderRow): ControlState | null {
  const wants = sliderWants(node, s);
  if (!wants.size) return null;
  const now = levelFor(s)?.mode ?? "run";
  const later: ToggleControl = (s.levels ?? []).some((l) => l.mode === "mute") ? "mute" : "bypass";
  const control: ToggleControl = now === "run" ? later : now;
  const off = [...wants.entries()].filter(([, m]) => m !== MODE_ALWAYS).map(([n]) => n);
  const names = off.slice(0, 4).map((n) => n.title || `#${n.id}`);
  if (off.length > 4) names.push(`${off.length - 4} more`);
  const hint = off.length
    ? `${control === "mute" ? "Mutes" : "Bypasses"} now: ${names.join(", ")}`
    : `Runs what it drives at this value (${wants.size} node${wants.size === 1 ? "" : "s"})`;
  return { control, active: off.length > 0, hint };
}
