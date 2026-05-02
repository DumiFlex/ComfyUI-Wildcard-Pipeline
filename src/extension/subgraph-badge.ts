import { walkAllNodes, collectUpstreamVariables, type LiteGraphLike, type LiteNodeLike } from "./graph";
import { scanConflicts, scanTemplateConflicts, labelFor, type Conflict, type Severity } from "./conflicts";
import { parseWidgetJson, type ContextWidgetValue } from "../widgets/_shared";
import { onGraphLoaded } from "./graph-events";

// ── Subgraph conflict badge ────────────────────────────────────────────
// Users can drop our nodes inside a subgraph. From the parent graph, the
// SubgraphNode is opaque — opening it is the only way to spot a problem.
// We push an LGraphBadge onto `node.badges` for every SubgraphNode that
// contains WP_Context or WP_PromptAssembler descendants and surface the
// worst severity found in their conflict scan.
//
// Why LGraphBadge and not onDrawForeground:
// - Badges render ABOVE the title bar (drawBadges places them at
//   y = -(NODE_TITLE_HEIGHT + gap) - height), so they never overlap the
//   built-in enter_subgraph button which lives INSIDE the title bar.
// - Built-in stacking + positioning handles multi-badge cases for free
//   if other extensions also want to badge the same node.

interface LGraphBadgeOpts {
  text?: string;
  fgColor?: string;
  bgColor?: string;
  fontSize?: number;
  padding?: number;
  height?: number;
  cornerRadius?: number;
  xOffset?: number;
  yOffset?: number;
}

interface LGraphBadgeInstance {
  text: string;
  fgColor: string;
  bgColor: string;
}

interface LGraphBadgeCtor {
  new (opts: LGraphBadgeOpts): LGraphBadgeInstance;
}

/** ComfyUI exposes the badge class on window via useGlobalLitegraph(). */
function getBadgeCtor(): LGraphBadgeCtor | null {
  return (window as unknown as { LGraphBadge?: LGraphBadgeCtor }).LGraphBadge ?? null;
}

type SubgraphNodeLike = LiteNodeLike & {
  size?: [number, number] | number[];
  badges?: unknown[];
  setDirtyCanvas?: (foreground: boolean, background: boolean) => void;
  onConnectionsChange?: (...args: unknown[]) => void;
  onRemoved?: (...args: unknown[]) => void;
  /** Internal: latest computed severity so we can avoid pushing duplicate badges. */
  _wpBadgeSeverity?: Severity | null;
  /** Internal: badge instance currently in `node.badges` (or null). */
  _wpBadge?: LGraphBadgeInstance | null;
  /** Internal: cleanup handle so we can detach observers on node removal. */
  _wpBadgeCleanup?: () => void;
};

interface SeverityColors { bg: string; fg: string }

const SEVERITY_COLORS: Record<Severity, SeverityColors> = {
  info:    { bg: "#6366f1", fg: "#ffffff" }, // indigo, --wp-accent
  warning: { bg: "#fbbf24", fg: "#0F1F0F" }, // amber, --wp-amber
  error:   { bg: "#f87171", fg: "#ffffff" }, // red, --wp-red
};

interface BadgeState {
  severity: Severity;
  /** Human-readable label that explains the issue at a glance. */
  text: string;
}

/**
 * Format the badge label. Casual users won't recognize "i" or "!" — they
 * need a phrase. We pick the worst-severity conflict and either name the
 * specific variable (when there's a single issue) or report the count.
 */
function formatBadgeText(worst: Conflict, sameSeverityCount: number): string {
  if (sameSeverityCount > 1) {
    if (worst.severity === "error") return `${sameSeverityCount} errors`;
    if (worst.severity === "warning") return `${sameSeverityCount} conflicts`;
    return `${sameSeverityCount} overrides`;
  }
  // Single issue — name the variable so the user knows exactly what to fix.
  // Use the canonical label from `conflicts.ts` so card tooltip + badge
  // text agree (e.g. both say "overrides upstream", neither says
  // "shadows" — the wording was drifting per UX QA).
  return `${labelFor(worst.type)} $${worst.variable}`;
}

const SEVERITY_RANK: Record<Severity, number> = { info: 1, warning: 2, error: 3 };

function widgetValue(node: LiteNodeLike, name: string): string {
  const w = node.widgets?.find((x) => x.name === name);
  return typeof w?.value === "string" ? w.value : "";
}

/**
 * Walk every WP node nested anywhere inside `subgraph` (across nested
 * subgraphs too) and collect all conflicts found. `rootGraph` is needed
 * because Context/Assembler conflict scans walk upstream across subgraph
 * boundaries — they need the root to build the subgraph-parents map.
 */
function collectInnerConflicts(rootGraph: LiteGraphLike, subgraph: LiteGraphLike): Conflict[] {
  const out: Conflict[] = [];
  for (const { node } of walkAllNodes(subgraph)) {
    if (node.type === "WP_Context") {
      const v = parseWidgetJson<ContextWidgetValue>(widgetValue(node, "modules"), { version: 1, modules: [] });
      const upstream = collectUpstreamVariables(rootGraph, node);
      // Only enabled modules count — disabled ones don't ship to runtime.
      const enabledOnly: ContextWidgetValue = { ...v, modules: v.modules.filter((m) => m.enabled) };
      out.push(...scanConflicts(enabledOnly, upstream));
    } else if (node.type === "WP_PromptAssembler") {
      const tmpl = widgetValue(node, "template");
      if (!tmpl) continue;
      const upstream = collectUpstreamVariables(rootGraph, node);
      out.push(...scanTemplateConflicts(tmpl, upstream));
    }
  }
  return out;
}

/**
 * Roll a list of conflicts up into a single badge state — picks the
 * worst severity, formats a human-readable label. Returns null when
 * there's nothing to surface.
 */
function computeBadgeState(rootGraph: LiteGraphLike, subgraph: LiteGraphLike): BadgeState | null {
  const conflicts = collectInnerConflicts(rootGraph, subgraph);
  if (!conflicts.length) return null;
  let worst = conflicts[0];
  for (const c of conflicts) {
    if (SEVERITY_RANK[c.severity] > SEVERITY_RANK[worst.severity]) worst = c;
  }
  const sameSeverityCount = conflicts.filter((c) => c.severity === worst.severity).length;
  return { severity: worst.severity, text: formatBadgeText(worst, sameSeverityCount) };
}

function removeBadge(node: SubgraphNodeLike) {
  if (!node._wpBadge || !Array.isArray(node.badges)) return;
  const idx = node.badges.indexOf(node._wpBadge);
  if (idx >= 0) node.badges.splice(idx, 1);
  node._wpBadge = null;
}

function applyBadge(node: SubgraphNodeLike, state: BadgeState, BadgeCtor: LGraphBadgeCtor) {
  const colors = SEVERITY_COLORS[state.severity];
  // Reuse the existing instance when possible — mutating fields keeps
  // ComfyUI's draw loop happy without churning the badges array.
  if (node._wpBadge) {
    node._wpBadge.text = state.text;
    node._wpBadge.bgColor = colors.bg;
    node._wpBadge.fgColor = colors.fg;
    return;
  }
  const badge = new BadgeCtor({
    text: state.text,
    bgColor: colors.bg,
    fgColor: colors.fg,
    fontSize: 12,
    padding: 6,
    height: 18,
    cornerRadius: 4,
  });
  if (!Array.isArray(node.badges)) node.badges = [];
  node.badges.push(badge);
  node._wpBadge = badge;
}

/**
 * Attach badge logic to a single SubgraphNode. Idempotent — a node already
 * attached gets its existing observer left alone. Cleanup is wired through
 * `node.onRemoved` so we don't leak intervals on node deletion.
 */
export function attachSubgraphBadge(node: SubgraphNodeLike, rootGraph: LiteGraphLike): void {
  if (node._wpBadgeCleanup) return; // already attached
  // Captured into a const here so the closure below sees a non-nullable
  // type — avoids the no-non-null-assertion lint while staying as cheap
  // as the previous `BadgeCtor!`.
  const Ctor: LGraphBadgeCtor | null = getBadgeCtor();
  if (!Ctor) {
    console.warn("[wildcard-pipeline] LGraphBadge not on window — badge skipped");
    return;
  }

  function recompute() {
    if (!node.subgraph || !Ctor) return;
    const next = computeBadgeState(rootGraph, node.subgraph);
    // Cache key includes both severity AND text — same severity with a new
    // variable name (e.g. user fixed $foo but $bar is still missing) needs a
    // re-render even though severity is unchanged.
    const sameAsBefore =
      (next === null && node._wpBadgeSeverity === null) ||
      (!!next && next.severity === node._wpBadgeSeverity && next.text === node._wpBadge?.text);
    if (sameAsBefore) return;
    node._wpBadgeSeverity = next?.severity ?? null;
    if (!next) removeBadge(node);
    else applyBadge(node, next, Ctor);
    node.setDirtyCanvas?.(true, true);
  }

  // Initial compute happens on next tick — workflow may still be loading
  // and the inner subgraph's nodes might not have widget values restored yet.
  queueMicrotask(recompute);

  // Polling fallback. 800ms is coarse but the badge isn't latency-critical;
  // the user is already used to seeing conflict dots within ~1s elsewhere.
  const interval = window.setInterval(recompute, 800);

  // Recompute on connection changes — wires added/removed inside the
  // subgraph or to/from the SubgraphNode itself.
  const origCC = node.onConnectionsChange;
  node.onConnectionsChange = function (...args: unknown[]) {
    origCC?.apply(this, args);
    recompute();
  };

  // Recompute when ComfyUI finishes restoring a workflow — a node loaded
  // mid-cascade may not have widget values yet on first compute.
  const unsubGraphLoaded = onGraphLoaded(() => {
    recompute();
    requestAnimationFrame(recompute);
  });

  // Cleanup wired through onRemoved so a deleted SubgraphNode tears down
  // its observers cleanly. We chain so other extensions still run.
  const origRemoved = node.onRemoved;
  node._wpBadgeCleanup = () => {
    window.clearInterval(interval);
    unsubGraphLoaded();
    node.onConnectionsChange = origCC;
    node.onRemoved = origRemoved;
    removeBadge(node);
    node._wpBadgeCleanup = undefined;
  };
  node.onRemoved = function (...args: unknown[]) {
    node._wpBadgeCleanup?.();
    origRemoved?.apply(this, args);
  };
}

/**
 * Walk the whole graph (root + nested subgraphs) and attach a badge to
 * every SubgraphNode. Used on workflow load, when nodes pre-exist.
 */
export function attachAllSubgraphBadges(rootGraph: LiteGraphLike): void {
  for (const { node } of walkAllNodes(rootGraph)) {
    if ((node as SubgraphNodeLike).subgraph) {
      attachSubgraphBadge(node as SubgraphNodeLike, rootGraph);
    }
  }
}
