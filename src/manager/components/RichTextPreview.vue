<script setup lang="ts">
/**
 * RichTextPreview
 *
 * Read-only counterpart to {@link RichTextInput}. Renders the same
 * mirror HTML produced by the shared `tokenizeRich` + `mirrorHtmlWithIdx`
 * helpers, without any textarea or autocomplete chrome. Used in list-row
 * expansions and any other place we want to show wildcard syntax with
 * styled chips at rest.
 *
 * When `clickable-refs` is set, `@{uuid}` ref pills emit a `ref-click`
 * event with the resolved UUID — consumers (e.g. TestRunner) can navigate
 * to the referenced wildcard editor on click. The event is wired via
 * delegation on the wrapper so we keep the single-`v-html` render path.
 */
import { computed } from "vue";
import { tokenizeRich } from "../../widgets/richTokenize";
import type { SurfaceKind, ResolveWarning } from "../utils/resolveTokens";

interface Props {
  value: string;
  surface?: SurfaceKind;
  warnings?: ResolveWarning[];
  /** Map from UUID to display name; used to render `@{uuid}` refs as human labels. */
  uuidToName?: Map<string, string>;
  /** When true, ref pills become clickable and emit `ref-click(uuid)`. */
  clickableRefs?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  surface: "wildcard",
  warnings: () => [],
  uuidToName: () => new Map(),
  clickableRefs: false,
});

const emit = defineEmits<{
  "ref-click": [uuid: string];
}>();

const HTML_ESC: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
};
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESC[c] ?? c);
}

const tokens = computed(() => tokenizeRich(props.value || ""));
// SAFE: all token text is HTML-escaped before concatenation.
// `@{uuid}` ref tokens are rendered with a human-readable display name
// when `uuidToName` provides one. Non-wildcard surfaces get a muted class.
// Refs that resolve to a known UUID get a `data-uuid` attribute so the
// click-delegation handler below can map a click back to its target.
const html = computed(() => {
  const toks = tokens.value;
  const isWildcard = props.surface === "wildcard";
  const map = props.uuidToName;
  const clickable = props.clickableRefs;
  let out = "";
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    let cls = `wp-rt-${t.kind}`;
    let display: string;
    let extra = "";
    if (t.kind === "ref") {
      if (!isWildcard) cls += " wp-rt-ref--ignored";
      const uuid = t.meta?.uuid;
      if (uuid && map.has(uuid)) {
        display = "@" + esc(map.get(uuid)!);
        if (clickable) {
          cls += " wp-rt-ref--clickable";
          // UUIDs are 8 hex chars — safe inside an attribute value.
          extra = ` data-uuid="${uuid}" role="link" tabindex="0"`;
        }
      } else {
        display = esc(t.raw);
      }
    } else {
      display = esc(t.raw);
    }
    out += `<span class="${cls}" data-idx="${i}"${extra}>${display}</span>`;
  }
  out += '<span class="wp-rt-tail">&#x200B;</span>';
  return out;
});

function onClick(e: MouseEvent): void {
  if (!props.clickableRefs) return;
  const target = (e.target as HTMLElement | null)?.closest?.("[data-uuid]");
  if (!target) return;
  const uuid = (target as HTMLElement).getAttribute("data-uuid");
  if (uuid) {
    e.preventDefault();
    e.stopPropagation();
    emit("ref-click", uuid);
  }
}

function onKey(e: KeyboardEvent): void {
  if (!props.clickableRefs) return;
  if (e.key !== "Enter" && e.key !== " ") return;
  const target = (e.target as HTMLElement | null)?.closest?.("[data-uuid]");
  if (!target) return;
  const uuid = (target as HTMLElement).getAttribute("data-uuid");
  if (uuid) {
    e.preventDefault();
    emit("ref-click", uuid);
  }
}
</script>

<template>
  <span
    class="wp-rt-preview wp-rt--rest"
    :class="{ 'wp-rt-preview--clickable': clickableRefs }"
    v-html="html"
    @click="onClick"
    @keydown="onKey"
  />
  <span
    v-for="w in warnings"
    :key="`${w.position}-${w.severity}`"
    class="wp-rt-warn-marker"
    :class="`wp-rt-warn-${w.severity}`"
    :data-warning-position="w.position"
    :title="w.message"
    aria-hidden="true"
  />
</template>

<style scoped>
.wp-rt-preview {
  display: inline;
  font-family: var(--wp-font-mono, ui-monospace, monospace);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

/* Token span chrome (chip backgrounds, var/ref colours, padding) lives in
   the global styles/rich-text.css so RichTextInput and this preview stay
   visually identical without duplicating rules. */
</style>
