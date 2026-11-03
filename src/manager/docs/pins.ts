/**
 * Numbered pins for the node pictures (`DocAnnotated`). Each
 * `pins/<image>.json` is written by `scripts/docs-shots/shoot.mjs` together
 * with its picture: where each field of the node (`node-fields.ts`) sits on
 * it, as fractions of the picture's width and height.
 */
import { NODE_FIELDS, type NodeField, type NodeFieldGroups } from "./node-fields";

export interface DocPin {
  group: string;
  term: string;
  /** 0–1 across the picture. */
  x: number;
  /** 0–1 down the picture. */
  y: number;
}

export interface PinSet {
  node: string;
  /** Picture path under the SPA's public base, e.g. `images/docs/wp-toggles.png`. */
  image: string;
  pins: DocPin[];
}

export interface NumberedPin extends DocPin {
  n: number;
  field: NodeField;
}

const FILES = import.meta.glob<PinSet>("./pins/*.json", { eager: true, import: "default" });

/** Every pin set, by picture path. */
export const PIN_SETS: Record<string, PinSet> = Object.fromEntries(
  Object.values(FILES).map((set) => [set.image, set]),
);

/** The field a pin stands for, or null when the field list no longer has it. */
export function fieldFor(node: string, pin: Pick<DocPin, "group" | "term">): NodeField | null {
  const groups: NodeFieldGroups | undefined = (NODE_FIELDS as Record<string, NodeFieldGroups>)[node];
  return groups?.[pin.group]?.find((f) => f.term === pin.term) ?? null;
}

/** How far apart two pin centres must be, as a share of the picture's width
 *  (a 20 px pin on the docs column's usual ~820 px picture, plus a hair). */
export const PIN_GAP = 0.027;

/**
 * A picture's pins in reading order (top to bottom, then left to right),
 * numbered from 1. `aspect` is the picture's height over its width: pins
 * that would sit on each other (a socket next to its own widget, two dots a
 * row apart on a small node) are pushed sideways, away from the middle of
 * the picture, until they clear.
 */
export function numberedPins(image: string, aspect = 0.5): NumberedPin[] {
  const set = PIN_SETS[image.replace(/^\/+/, "")];
  if (!set) return [];
  const rows = (p: DocPin) => Math.round(p.y * 24);
  const pins = set.pins
    .flatMap((p) => {
      const field = fieldFor(set.node, p);
      return field ? [{ ...p, field }] : [];
    })
    .sort((a, b) => rows(a) - rows(b) || a.x - b.x)
    .map((p, i) => ({ ...p, n: i + 1 }));
  return spread(pins, aspect);
}

/** Push overlapping pins apart along x (y stays on its row). */
function spread<T extends DocPin>(pins: T[], aspect: number): T[] {
  const placed: T[] = [];
  for (const pin of pins) {
    const p = { ...pin };
    for (let guard = 0; guard < 12; guard++) {
      const hit = placed.find((q) => Math.hypot(p.x - q.x, (p.y - q.y) * aspect) < PIN_GAP - 1e-6);
      if (!hit) break;
      const dy = (p.y - hit.y) * aspect;
      const need = Math.sqrt(Math.max(0, PIN_GAP * PIN_GAP - dy * dy));
      const dir = p.x > hit.x || (p.x === hit.x && p.x >= 0.5) ? 1 : -1;
      p.x = Math.min(1, Math.max(0, hit.x + dir * need));
    }
    placed.push(p);
  }
  return placed;
}

/** The first sentence of a field's text, for the legend under the picture. */
export function firstSentence(text: string): string {
  const m = /^(.+?[.!?])(\s|$)/.exec(text.trim());
  return m?.[1] ?? text.trim();
}
