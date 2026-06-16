<script setup lang="ts">
/**
 * RuleValueChips — read-only chip renderer for a derivation rule's
 * action.value / condition.value strings inside the canvas instance modal
 * summary. Tokenizes the value and renders `@{uuid}` nested-wildcard refs +
 * `$var` references as CHIPS, brace blocks / escapes as colored spans — so a
 * value like `@{ad00acd5#mood:warm}` reads as a `@mood` chip with a funnel
 * mark instead of leaking raw hex.
 *
 * Chip markup + CSS are copied verbatim from the wildcard editor's OptionRow
 * (`editors/wildcard/sections/OptionRow.vue`) so the canvas reads identically
 * to the option-value chips. Names resolve from the modal-supplied
 * `uuidToName` map (the live library catalog) — no preview-resolver dep on
 * this surface. A missing display value renders the placeholder text.
 */
import { computed } from "vue";
import { splitRefFilter, tokenizeRich, type RichToken } from "../../../../../widgets/richTokenize";
import { parse, readsAs } from "@/manager/parsing/subcatFilter";

const props = withDefaults(
  defineProps<{
    value?: string;
    /** UUID → display name, from the modal's catalog fetch. Empty until the
     *  fetch resolves — chips fall back to the token's cached `#name`. */
    uuidToName?: Map<string, string>;
    /** Shown when `value` is empty (mirrors the old `|| "?"` placeholder). */
    placeholder?: string;
  }>(),
  { value: "", uuidToName: () => new Map(), placeholder: "?" },
);

const tokens = computed<RichToken[]>(() => tokenizeRich(props.value ?? ""));
const isEmpty = computed(() => (props.value ?? "").length === 0);

/** Human label for a ref chip — `@name` from the live map, else the cached
 *  `#name` (stripping a leaked `!null`), else the raw token. Mirrors
 *  OptionRow.refDisplay's fallback chain. */
function refDisplay(tok: RichToken): string {
  const uuid = tok.meta?.uuid;
  if (!uuid) return tok.raw;
  const live = props.uuidToName.get(uuid);
  if (live && live.trim()) return `@${live.trim()}`;
  const cached = typeof tok.meta?.name === "string" ? tok.meta.name : "";
  if (cached.trim()) return `@${cached.split("!")[0].trim() || cached.trim()}`;
  return tok.raw;
}

/** Ref uuid absent from the live map → broken reference. Empty map (pre-fetch)
 *  is "unknown, not broken" so chips don't flash red while loading. */
function refIsUnresolved(tok: RichToken): boolean {
  const uuid = tok.meta?.uuid;
  if (!uuid) return false;
  if (props.uuidToName.size === 0) return false;
  return !props.uuidToName.has(uuid);
}

interface RefFilterInfo { hasExpr: boolean; excludeNull: boolean; isFiltered: boolean; title: string }
const _refFilterMemo = new WeakMap<RichToken, RefFilterInfo>();
/** Funnel (sub-cat expression) + ban (null excluded) marks + hover title.
 *  Copied from OptionRow.refFilter. */
function refFilter(tok: RichToken): RefFilterInfo {
  const cached = _refFilterMemo.get(tok);
  if (cached) return cached;
  const subs = tok.meta?.sub_categories;
  let expr = "";
  let excludeNull = false;
  if (Array.isArray(subs) && subs.length > 0) {
    ({ expr, excludeNull } = splitRefFilter(subs.join(",")));
  } else {
    const name = typeof tok.meta?.name === "string" ? tok.meta.name : "";
    const bang = name.indexOf("!");
    if (bang >= 0) excludeNull = name.slice(bang + 1) === "null";
  }
  let reads = "";
  if (expr) {
    try { reads = readsAs(parse(expr)); } catch { reads = expr; }
  }
  const parts: string[] = [];
  if (reads) parts.push(reads);
  if (excludeNull) parts.push("null excluded");
  const info: RefFilterInfo = {
    hasExpr: expr.length > 0,
    excludeNull,
    isFiltered: expr.length > 0 || excludeNull,
    title: parts.join(" · "),
  };
  _refFilterMemo.set(tok, info);
  return info;
}
</script>

<template>
  <span class="rvc">
    <span v-if="isEmpty" class="rvc__placeholder">{{ placeholder }}</span>
    <template v-for="(tok, idx) in tokens" v-else :key="idx">
      <span
        v-if="tok.kind === 'ref'"
        class="rvc__tok rvc__tok--ref"
        :class="{
          'rvc__tok--filtered': refFilter(tok).isFiltered,
          'rvc__tok--unresolved': refIsUnresolved(tok),
        }"
        :data-uuid="tok.meta?.uuid"
        :title="refIsUnresolved(tok)
          ? `Reference ${tok.meta?.uuid} not in library`
          : (refFilter(tok).title || undefined)"
      >
        <span class="rvc__tok-icon" aria-hidden="true">{{ refIsUnresolved(tok) ? '?' : '✦' }}</span>
        <span class="rvc__tok-label">{{ refDisplay(tok) }}</span>
        <span
          v-if="refFilter(tok).isFiltered"
          class="rvc__tok-filter"
          aria-hidden="true"
        >
          <i v-if="refFilter(tok).hasExpr" class="pi pi-filter rvc__tok-funnel"></i>
          <i v-if="refFilter(tok).excludeNull" class="pi pi-ban rvc__tok-nonull"></i>
        </span>
      </span>
      <span
        v-else-if="tok.kind === 'var'"
        class="rvc__tok rvc__tok--var"
      >
        <span class="rvc__tok-icon" aria-hidden="true">⌘</span>
        <span class="rvc__tok-label">{{ tok.raw }}</span>
      </span>
      <span v-else-if="tok.kind === 'dp-brace'" class="rvc__tok rvc__tok--brace">{{ tok.raw }}</span>
      <span v-else-if="tok.kind === 'dp-multi'" class="rvc__tok rvc__tok--multi">{{ tok.raw }}</span>
      <span v-else-if="tok.kind === 'escape'" class="rvc__tok rvc__tok--escape">{{ tok.raw }}</span>
      <template v-else>{{ tok.raw }}</template>
    </template>
  </span>
</template>

<style scoped>
/* Inline-syntax chips — palette + icon prefix copied from the wildcard
 * OptionRow (`editors/wildcard/sections/OptionRow.vue`) so an `@nestedName`
 * reads the same in the derivation summary as in an option value: purple ✦
 * for refs, green ⌘ for vars, amber funnel/ban filter marks. */
.rvc {
  display: inline;
}
.rvc__placeholder {
  color: var(--wp-text);
  background: color-mix(in srgb, var(--wp-text-dim, var(--wp-text3)) 12%, transparent);
  padding: 0 4px;
  border-radius: 2px;
}
.rvc__tok {
  margin: 0 1px;
  font-weight: 500;
  display: inline-flex;
  align-items: baseline;
  vertical-align: baseline;
}
.rvc__tok--ref,
.rvc__tok--var {
  border-radius: 3px;
  padding: 0 5px;
  gap: 3px;
  border: 1px solid;
  font: 10px/1.4 var(--wp-font-mono);
}
.rvc__tok-icon { font-size: 8px; opacity: 0.75; }
.rvc__tok-filter {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 2px;
  color: var(--wp-status-modified, #fbbf24);
}
.rvc__tok-funnel { font-size: 8px; line-height: 1; }
.rvc__tok-nonull { font-size: 8px; line-height: 1; opacity: 0.85; }
.rvc__tok--ref {
  background: color-mix(in srgb, var(--wp-kind-wildcard, #a855f7) 15%, transparent);
  border-color: color-mix(in srgb, var(--wp-kind-wildcard, #a855f7) 50%, transparent);
  color: var(--wp-kind-wildcard);
}
.rvc__tok--ref.rvc__tok--unresolved {
  background: color-mix(in srgb, var(--wp-danger, #ef4444) 15%, transparent);
  border-color: color-mix(in srgb, var(--wp-danger, #ef4444) 50%, transparent);
  color: var(--wp-danger, #ef4444);
  cursor: help;
}
.rvc__tok--var {
  background: color-mix(in srgb, var(--wp-success, #22c55e) 15%, transparent);
  border-color: color-mix(in srgb, var(--wp-success, #22c55e) 50%, transparent);
  color: var(--wp-success);
}
.rvc__tok--brace {
  color: var(--wp-warn, #fcd34d);
  font-weight: 600;
}
.rvc__tok--multi {
  color: var(--wp-rt-token-good, #4ad4c4);
  font-weight: 500;
}
.rvc__tok--escape {
  color: var(--wp-text-muted, var(--wp-text2));
  opacity: 0.7;
}
</style>
