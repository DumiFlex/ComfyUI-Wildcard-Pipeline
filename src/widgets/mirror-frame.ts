/**
 * The frame around a panel shown on a subgraph node (see "Mirrors" in
 * `_shared.ts`): the kit Disclosure with the inner node's title, a "Choose
 * what shows" menu and a Hide button in its heading.
 *
 * A panel marks the parts that can be left out with `data-wp-part="<id>"`
 * plus `data-wp-part-label` (what the menu says) and, optionally,
 * `data-wp-part-section` (the heading it is listed under). The menu lists the
 * parts the copy has right now, in the order they are drawn; a part left out
 * is hidden with one CSS rule on this copy, so the panel's own code never
 * changes and the node inside keeps everything.
 */
import { computed, defineAsyncComponent, defineComponent, h, onMounted, ref, type Component, type PropType } from "vue";
import type { ContextMenuEntry } from "@/kit/ContextMenu.vue";

const Disclosure = defineAsyncComponent(() => import("@/kit/Disclosure.vue"));
const DropdownMenu = defineAsyncComponent(() => import("@/kit/DropdownMenu.vue"));
const Button = defineAsyncComponent(() => import("@/kit/Button.vue"));

export interface PanelPart {
  id: string;
  label: string;
  section: string;
}

/** The parts a panel's markup offers, in drawing order, each id once. */
export function readParts(root: ParentNode | null | undefined): PanelPart[] {
  const out: PanelPart[] = [];
  const seen = new Set<string>();
  for (const el of root?.querySelectorAll<HTMLElement>("[data-wp-part]") ?? []) {
    const id = el.dataset.wpPart ?? "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: el.dataset.wpPartLabel || id, section: el.dataset.wpPartSection ?? "" });
  }
  return out;
}

function escapeAttr(v: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(v) : v.replace(/["\\]/g, "\\$&");
}

/** The rule that hides `hidden` parts inside the copy marked `scope`. */
export function hideRule(scope: string, hidden: readonly string[]): string {
  if (!hidden.length) return "";
  const sel = hidden.map((id) => `.wp-mirror[data-wp-mirror="${escapeAttr(scope)}"] [data-wp-part="${escapeAttr(id)}"]`);
  return `${sel.join(",\n")} { display: none !important; }`;
}

/** Move up / Move down, under "Position"; nothing when the copy is alone. */
export function moveEntries(canMove: (dir: -1 | 1) => boolean, move: (dir: -1 | 1) => void): ContextMenuEntry[] {
  const up = canMove(-1);
  const down = canMove(1);
  if (!up && !down) return [];
  return [
    { section: "Position" },
    { label: "Move up", icon: "pi-arrow-up", disabled: !up, onSelect: () => move(-1) },
    { label: "Move down", icon: "pi-arrow-down", disabled: !down, onSelect: () => move(1) },
  ];
}

/** Menu entries: Show all, then one tick per part under its section. */
export function partEntries(parts: readonly PanelPart[], hidden: readonly string[], set: (next: string[]) => void): ContextMenuEntry[] {
  const off = new Set(hidden);
  const entries: ContextMenuEntry[] = [];
  if (!parts.length) {
    entries.push({ label: "This panel shows whole", disabled: true, onSelect: () => undefined });
    return entries;
  }
  entries.push({
    label: "Show all",
    icon: "pi-eye",
    disabled: !parts.some((p) => off.has(p.id)),
    keepOpen: true,
    onSelect: () => set([]),
  });
  let section: string | null = null;
  for (const p of parts) {
    if (p.section !== section) {
      section = p.section;
      if (section) entries.push({ section });
    }
    entries.push({
      label: p.label,
      checked: !off.has(p.id),
      keepOpen: true,
      onSelect: () => set(off.has(p.id) ? hidden.filter((h) => h !== p.id) : [...hidden, p.id]),
    });
  }
  return entries;
}

export default defineComponent({
  name: "WpMirrorFrame",
  props: {
    scope: { type: String, required: true },
    title: { type: Function as PropType<() => string>, required: true },
    hidden: { type: Array as PropType<string[]>, default: () => [] },
    inner: { type: [Object, Function] as PropType<Component>, required: true },
    innerProps: { type: Object as PropType<Record<string, unknown>>, default: () => ({}) },
    canMove: { type: Function as PropType<(dir: -1 | 1) => boolean>, default: () => false },
  },
  emits: ["hide", "update:hidden", "move"],
  setup(props, { emit }) {
    const root = ref<HTMLElement | null>(null);
    const hidden = ref<string[]>([...props.hidden]);
    /** Bumped when the menu opens, so it lists the parts drawn right now. */
    const looked = ref(0);
    const parts = computed(() => {
      void looked.value;
      return readParts(root.value);
    });
    function set(next: string[]): void {
      hidden.value = next;
      emit("update:hidden", next);
    }
    onMounted(() => {
      looked.value += 1;
    });
    return () =>
      h("div", { ref: root, class: "wp-mirror", "data-wp-mirror": props.scope }, [
        hidden.value.length ? h("style", hideRule(props.scope, hidden.value)) : null,
        h(Disclosure, { label: props.title(), defaultOpen: true, flush: true, size: "sm" }, {
          actions: () => [
            h(DropdownMenu, { items: [...partEntries(parts.value, hidden.value, set), ...moveEntries(props.canMove, (dir) => emit("move", dir))], label: "Choose what shows", placement: "bottom-end" }, {
              trigger: ({ props: trigger }: { props: Record<string, unknown> & { onClick: () => void } }) =>
                h(Button, {
                  ...trigger,
                  variant: "ghost",
                  icon: "sliders-h",
                  size: "sm",
                  "aria-label": "Choose what shows",
                  pressed: hidden.value.length > 0,
                  onClick: () => {
                    looked.value += 1;
                    trigger.onClick();
                  },
                }),
            }),
            h(Button, { variant: "ghost", icon: "times", size: "sm", "aria-label": "Hide from subgraph node", onClick: () => emit("hide") }),
          ],
          default: () => h(props.inner, props.innerProps),
        }),
      ]);
  },
});
