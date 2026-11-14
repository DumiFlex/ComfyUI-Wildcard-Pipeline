<script setup lang="ts">
/** Per-iteration seed modal — shared by the Context Loop + Seed List
 *  node widgets. Computes the derived list locally (seed-derive mirror)
 *  and overlays seed_locks; edits re-emit the full merged lock map. */
import Kbd from "@/kit/Kbd.vue";
import { computed, onBeforeUnmount, ref } from "vue";
import { deriveLoopSeeds, parseSeedLocks, type SeedStrategy } from "./seed-derive";
import SeedLockRow from "./SeedLockRow.vue";
import Button from "@/kit/Button.vue";
import Modal from "@/kit/Modal.vue";

const props = defineProps<{
  nodeName: string;
  baseSeed: number;
  count: number;
  strategy: SeedStrategy;
  seedLocks: Record<string, number>;
  /** Yellow override notice text; empty/undefined hides it. Context Loop
   *  shows it when "Override Context seed" is OFF (a nudge); Seed List shows
   *  it when "Override base seed from loop" is ON (base comes from the loop). */
  overrideHint?: string;
  /** The seed each frame used on the PREVIOUS run (captured loop series),
   *  indexed by frame. Drives the per-row "lock previous" button; absent or
   *  short → that frame's button greys out. Distinct from the computed
   *  `derived` series, which is the UPCOMING seeds from the current base. */
  previousSeeds?: number[] | null;
  /** 0-based bypassed frame indices. When PASSED, bypassed rows dim + strike.
   *  Absent → no bypass display at all. */
  bypassFrames?: number[];
  /** Read-only bypass (Seed List mirroring a loop): show bypassed rows dimmed
   *  but WITHOUT an interactive toggle — bypass is owned by the loop node.
   *  Default false (Context Loop = interactive toggles). */
  bypassReadonly?: boolean;
}>();
const emit = defineEmits<{
  "update:seedLocks": [next: Record<string, number>];
  "update:bypassFrames": [next: number[]];
  close: [];
}>();

const derived = computed(() => deriveLoopSeeds(props.baseSeed, Math.max(1, props.count), props.strategy));
const lockedCount = computed(() => Object.keys(props.seedLocks).length);
const copied = ref(false);
const pasted = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
let pastedTimer: ReturnType<typeof setTimeout> | undefined;
/** Locked indices beyond the current count — shown dimmed below the active
 *  rows so a forgotten out-of-range lock is visible (it re-applies if count
 *  grows back). */
const inactiveLocks = computed(() => {
  const active = derived.value.length;
  return Object.keys(props.seedLocks)
    .map(Number)
    .filter((i) => Number.isInteger(i) && i >= active)
    .sort((a, b) => a - b);
});

const bypassEnabled = computed(() => props.bypassFrames !== undefined);
/** Interactive toggle only when bypass is enabled AND not read-only. In
 *  read-only mode rows still show the bypassed (dim + strike) state — that's
 *  the `:bypassed` prop, independent of `:bypassable`. */
const bypassInteractive = computed(() => bypassEnabled.value && !props.bypassReadonly);
const bypassSet = computed(() => new Set(props.bypassFrames ?? []));
const bypassCount = computed(() => (props.bypassFrames ?? []).length);
/** Number of in-range frames NOT bypassed. */
const activeFrameCount = computed(() => {
  let n = 0;
  for (let i = 0; i < derived.value.length; i++) if (!bypassSet.value.has(i)) n++;
  return n;
});
/** Bypass toggle is disabled for an ACTIVE frame when it's the last one left. */
function bypassDisabledFor(i: number): boolean {
  return !bypassSet.value.has(i) && activeFrameCount.value <= 1;
}
/** Bypassed indices beyond the current count — dimmed, re-apply if count grows. */
const inactiveBypass = computed(() =>
  [...bypassSet.value].filter((i) => i >= derived.value.length).sort((a, b) => a - b),
);
/** Real derived seed for any index (out-of-range inactive rows compute it on
 *  the fly since `derived` only spans the active count). PRECONDITION: `i >= 1`
 *  — only ever called for inactive rows where `i >= derived.length >= 1`. At
 *  `i === 0` deriveLoopSeeds hits its `count <= 1` branch and returns the base
 *  seed, NOT the series' derived[0], so do not reuse this for in-range index 0. */
function seedAt(i: number): number {
  return deriveLoopSeeds(props.baseSeed, i + 1, props.strategy)[i] ?? 0;
}
function onBypass(p: { index: number; bypassed: boolean }): void {
  const next = new Set(bypassSet.value);
  if (p.bypassed) next.add(p.index);
  else next.delete(p.index);
  emit("update:bypassFrames", [...next].sort((a, b) => a - b));
}
function onRow(p: { index: number; seed: number | null }): void {
  const next = { ...props.seedLocks };
  if (p.seed == null) delete next[String(p.index)];
  else next[String(p.index)] = p.seed;
  emit("update:seedLocks", next);
}
function lockAll(): void {
  const next: Record<string, number> = {};
  derived.value.forEach((s, i) => { next[String(i)] = s; });
  emit("update:seedLocks", next);
}
function unlockAll(): void { emit("update:seedLocks", {}); }
/** Build the `#N: seed` clipboard text. lockedOnly → just the locked rows
 *  (round-trips through Paste to re-lock exactly those); else every iteration
 *  with locks overlaid. */
function copyText(lockedOnly: boolean): string {
  if (lockedOnly) {
    return Object.keys(props.seedLocks)
      .map(Number)
      .sort((a, b) => a - b)
      .map((i) => `#${i + 1}: ${props.seedLocks[String(i)]}`)
      .join("\n");
  }
  return derived.value.map((s, i) => `#${i + 1}: ${props.seedLocks[String(i)] ?? s}`).join("\n");
}
function copyAll(ev: MouseEvent): void {
  void navigator.clipboard?.writeText(copyText(ev.altKey)); // Alt-click → locked seeds only
  copied.value = true;
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => { copied.value = false; }, 1500);
}
/** Read the clipboard, parse the `#N: seed` format Copy produces, and REPLACE
 *  the whole lock map with it. No-op on empty/garbage so a stray paste can't
 *  wipe existing locks. Pasted indices beyond count land as inactive rows. */
async function pasteAll(): Promise<void> {
  let text = "";
  try { text = (await navigator.clipboard?.readText()) ?? ""; } catch { text = ""; }
  const next = parseSeedLocks(text);
  if (Object.keys(next).length === 0) return;
  emit("update:seedLocks", next);
  pasted.value = true;
  if (pastedTimer) clearTimeout(pastedTimer);
  pastedTimer = setTimeout(() => { pasted.value = false; }, 1500);
}
onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer);
  if (pastedTimer) clearTimeout(pastedTimer);
});
</script>

<template>
  <Modal :open="true" size="md" flush accent="var(--wp-accent)" icon="list" @update:open="(v: boolean) => { if (!v) emit('close'); }">
    <template #header="{ titleId }">
      <div class="sm__title-block">
        <div class="sm__title-row"><span :id="titleId" class="sm__name">{{ nodeName }}</span><span class="sm__chip">Iteration Seeds</span></div>
        <div class="sm__sub">base {{ baseSeed }} · {{ strategy }} · {{ Math.max(1, count) }} iterations</div>
      </div>
    </template>
      <div class="sm" data-test="seed-modal">
        <div class="sm__bar">
          <span class="sm__count">{{ Math.max(1, count) }} iterations</span>
          <span class="sm__strat">{{ strategy }}</span>
          <span v-if="lockedCount" class="sm__lockcount" data-test="mx-seed-lockcount">{{ lockedCount }} locked</span>
          <span v-if="bypassEnabled && bypassCount" class="sm__lockcount" data-test="mx-bypass-count">{{ bypassCount }} bypassed</span>
          <span class="sm__bar-spacer" />
          <Button size="sm" variant="outline" data-test="mx-seed-lockall" @click="lockAll">Lock all</Button>
          <Button size="sm" variant="outline" data-test="mx-seed-unlockall" @click="unlockAll">Unlock all</Button>
          <Button
            size="sm"
            variant="outline" :class="{ 'sm__done': copied }" :icon="copied ? 'pi-check' : 'pi-copy'"
            data-test="mx-seed-copy" hint="Copy all seeds · Alt-click to copy only the locked ones" @click="copyAll"
          >{{ copied ? "Copied" : "Copy" }}</Button>
        </div>

        <div v-if="overrideHint" class="sm__hint" data-test="mx-seed-hint">
          <i class="pi pi-info-circle" aria-hidden="true" />
          <span>{{ overrideHint }}</span>
        </div>

        <div class="sm__list">
          <SeedLockRow v-for="(s, i) in derived" :key="i" :index="i" :derived="s"
            :locked="Object.prototype.hasOwnProperty.call(seedLocks, String(i))"
            :seed="seedLocks[String(i)] ?? null" :previous="previousSeeds?.[i] ?? null"
            :bypassable="bypassInteractive" :bypassed="bypassSet.has(i)"
            :bypass-disabled="bypassDisabledFor(i)"
            @update="onRow" @bypass="onBypass" />
          <template v-if="inactiveBypass.length">
            <div class="sm__inactive-label" data-test="mx-bypass-inactive">
              Bypassed · won't apply at count {{ derived.length }}
            </div>
            <SeedLockRow v-for="i in inactiveBypass" :key="`inbypass-${i}`" :index="i"
              :derived="seedAt(i)"
              :locked="Object.prototype.hasOwnProperty.call(seedLocks, String(i))"
              :seed="seedLocks[String(i)] ?? null" :previous="previousSeeds?.[i] ?? null"
              :inactive="true" :bypassable="bypassInteractive" :bypassed="true"
              @update="onRow" @bypass="onBypass" />
          </template>
          <template v-if="inactiveLocks.length">
            <div class="sm__inactive-label" data-test="mx-seed-inactive">
              Inactive · won't apply at count {{ derived.length }}
            </div>
            <SeedLockRow v-for="i in inactiveLocks" :key="`inact-${i}`" :index="i"
              :derived="seedLocks[String(i)]" :locked="true" :seed="seedLocks[String(i)]"
              :previous="previousSeeds?.[i] ?? null" :inactive="true" @update="onRow" />
          </template>
        </div>

      </div>
    <template #footer>
      <span class="sm__foot-hint"><Kbd keys="Esc" size="sm" /> to close · locks save with the node</span>
      <span class="sm__foot-spacer" />
      <Button
        size="sm"
        variant="outline" :class="{ 'sm__done': pasted }" :icon="pasted ? 'pi-check' : 'pi-clipboard'"
        data-test="mx-seed-paste" hint="Replace all locks from copied text" @click="pasteAll"
      >{{ pasted ? "Pasted" : "Paste" }}</Button>
      <Button size="sm" variant="primary" data-test="seed-modal-done" @click="emit('close')">Done</Button>
    </template>
  </Modal>
</template>

<style scoped>
/* The kit Modal at size md (560px), up from 486px: the toolbar (iterations · strategy · N locked · N
 * bypassed · Lock all · Unlock all · Copy) and each row's three toggles were
 * being squeezed into near-square boxes to fit. Widening is the cheaper fix
 * than re-organising the toolbar. */
.sm { display: flex; flex-direction: column; color: var(--wp-text); font-size: 12px; font-family: var(--wp-font-sans, sans-serif); }
.sm__title-block { flex: 1; min-width: 0; }
.sm__title-row { display: flex; align-items: center; gap: 8px; }
.sm__name { font: 600 13px var(--wp-font-sans); color: var(--wp-text); }
.sm__chip { font: 600 9px var(--wp-font-sans); text-transform: uppercase; letter-spacing: .06em; padding: 2px 6px; border-radius: min(2px, var(--wp-radius-cap, 999px)); background: color-mix(in srgb, var(--wp-modal-accent, var(--wp-accent)) 22%, transparent); color: var(--wp-modal-accent, var(--wp-accent)); }
.sm__sub { font: 400 10px var(--wp-font-mono); color: var(--wp-text-dim, var(--wp-text3)); margin-top: 3px; }
.sm__bar { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 8px; padding: 9px 14px; flex-shrink: 0; border-bottom: 1px solid var(--wp-border); background: var(--wp-bg-2); }
.sm__count { font: 600 11px var(--wp-font-sans); color: var(--wp-text-muted, var(--wp-text2)); }
.sm__strat { font: 600 9px var(--wp-font-mono); text-transform: uppercase; letter-spacing: .05em; padding: 2px 7px; border-radius: min(3px, var(--wp-radius-cap, 999px)); color: var(--wp-text-muted, var(--wp-text2)); background: var(--wp-bg-deep, var(--wp-bg)); border: 1px solid var(--wp-border); }
.sm__lockcount { font: 600 9px var(--wp-font-sans); text-transform: uppercase; letter-spacing: .05em; padding: 2px 7px; border-radius: min(3px, var(--wp-radius-cap, 999px)); color: var(--wp-accent-text, var(--wp-text)); background: rgba(99,102,241,.12); border: 1px solid color-mix(in srgb, var(--wp-accent) 40%, transparent); }
.sm__bar-spacer { flex: 1; }
.sm__done, .sm__done:hover { border-color: var(--wp-green); color: var(--wp-green); }
.sm__hint { display: flex; align-items: center; gap: 7px; padding: 7px 14px; flex-shrink: 0; font: 11px var(--wp-font-sans); color: color-mix(in srgb, var(--wp-amber) 75%, var(--wp-text-muted)); background: color-mix(in srgb, var(--wp-amber) 9%, transparent); border-bottom: 1px solid var(--wp-border); }
.sm__hint .pi { flex-shrink: 0; color: var(--wp-amber); }
.sm__list { padding: 6px; }
.sm__inactive-label { padding: 8px 8px 4px; margin-top: 4px; border-top: 1px dashed var(--wp-border); font: 600 9px var(--wp-font-sans); text-transform: uppercase; letter-spacing: .08em; color: var(--wp-text-dim, var(--wp-text3)); }
.sm__foot-hint { font: 10px var(--wp-font-sans); color: var(--wp-text-dim, var(--wp-text3)); }
.sm__foot-spacer { flex: 1; }
</style>
