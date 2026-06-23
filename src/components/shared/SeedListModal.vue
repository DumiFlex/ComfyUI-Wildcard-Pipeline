<script setup lang="ts">
/** Per-iteration seed modal — shared by the Context Loop + Seed List
 *  node widgets. Computes the derived list locally (seed-derive mirror)
 *  and overlays seed_locks; edits re-emit the full merged lock map. */
import { computed, onBeforeUnmount, onMounted } from "vue";
import { deriveLoopSeeds, type SeedStrategy } from "./seed-derive";
import SeedLockRow from "./SeedLockRow.vue";

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
}>();
const emit = defineEmits<{ "update:seedLocks": [next: Record<string, number>]; close: [] }>();

const derived = computed(() => deriveLoopSeeds(props.baseSeed, Math.max(1, props.count), props.strategy));
const lockedCount = computed(() => Object.keys(props.seedLocks).length);

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
function copyAll(): void {
  const text = derived.value
    .map((s, i) => `#${i + 1}: ${props.seedLocks[String(i)] ?? s}`).join("\n");
  void navigator.clipboard?.writeText(text);
}
function onKeydown(ev: KeyboardEvent): void {
  if (ev.key === "Escape") { ev.preventDefault(); emit("close"); }
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <Teleport to="body">
    <div class="sm-overlay" @click="emit('close')">
      <div class="sm" role="dialog" aria-modal="true" data-test="seed-modal" @click.stop>
        <div class="sm__head">
          <span class="sm__head-icon"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10" /><circle cx="20" cy="18" r="1.4" fill="currentColor" stroke="none" /></svg></span>
          <div class="sm__title-block">
            <div class="sm__title-row"><span class="sm__name">{{ nodeName }}</span><span class="sm__chip">Iteration Seeds</span></div>
            <div class="sm__sub">base {{ baseSeed }} · {{ strategy }} · {{ Math.max(1, count) }} iterations</div>
          </div>
          <button class="sm__close" data-test="seed-modal-close" aria-label="Close" @click="emit('close')">
            <svg width="12" height="12" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19" /></svg>
          </button>
        </div>

        <div class="sm__bar">
          <span class="sm__count">{{ Math.max(1, count) }} iterations</span>
          <span class="sm__strat">{{ strategy }}</span>
          <span v-if="lockedCount" class="sm__lockcount" data-test="mx-seed-lockcount">{{ lockedCount }} locked</span>
          <span class="sm__bar-spacer" />
          <button class="ghost" data-test="mx-seed-lockall" @click="lockAll">Lock all</button>
          <button class="ghost" data-test="mx-seed-unlockall" @click="unlockAll">Unlock all</button>
          <button class="ghost" data-test="mx-seed-copy" @click="copyAll">Copy</button>
        </div>

        <div v-if="overrideHint" class="sm__hint" data-test="mx-seed-hint">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9" /><path d="M12 11v5" stroke-linecap="round" /><circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none" /></svg>
          <span>{{ overrideHint }}</span>
        </div>

        <div class="sm__list">
          <SeedLockRow v-for="(s, i) in derived" :key="i" :index="i" :derived="s"
            :locked="Object.prototype.hasOwnProperty.call(seedLocks, String(i))"
            :seed="seedLocks[String(i)] ?? null" @update="onRow" />
        </div>

        <div class="sm__foot">
          <span class="sm__foot-hint"><kbd>Esc</kbd> to close · locks save with the node</span>
          <span class="sm__foot-spacer" />
          <button class="btn" data-test="seed-modal-done" @click="emit('close')">Done</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
@import "./theme.css";
.sm-overlay { position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(0,0,0,.62); font-family: var(--wp-font-sans, sans-serif); }
.sm { width: 486px; max-width: 100%; max-height: 86vh; display: flex; flex-direction: column; background: var(--wp-bg2); border: 1px solid var(--wp-border); border-radius: 6px; overflow: hidden; color: var(--wp-text); font-size: 12px; box-shadow: 0 18px 50px rgba(0,0,0,.55); }
.sm__head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; flex-shrink: 0; border-bottom: 1px solid var(--wp-border); background: linear-gradient(180deg, color-mix(in srgb, var(--wp-accent) 18%, var(--wp-bg2)) 0%, var(--wp-bg2) 100%); }
.sm__head-icon { color: var(--wp-accent); width: 24px; display: flex; justify-content: center; }
.sm__title-block { flex: 1; min-width: 0; }
.sm__title-row { display: flex; align-items: center; gap: 8px; }
.sm__name { font: 600 13px var(--wp-font-sans); color: var(--wp-text); }
.sm__chip { font: 600 9px var(--wp-font-sans); text-transform: uppercase; letter-spacing: .06em; padding: 2px 6px; border-radius: 2px; background: color-mix(in srgb, var(--wp-accent) 22%, transparent); color: var(--wp-accent); }
.sm__sub { font: 400 10px var(--wp-font-mono); color: var(--wp-text-dim, var(--wp-text3)); margin-top: 3px; }
.sm__close { background: transparent; border: 0; color: var(--wp-text-dim, var(--wp-text3)); cursor: pointer; padding: 4px; display: flex; }
.sm__close:hover { color: var(--wp-text); }
.sm__bar { display: flex; align-items: center; gap: 8px; padding: 9px 14px; flex-shrink: 0; border-bottom: 1px solid var(--wp-border); }
.sm__count { font: 600 11px var(--wp-font-sans); color: var(--wp-text-muted, var(--wp-text2)); }
.sm__strat { font: 600 9px var(--wp-font-mono); text-transform: uppercase; letter-spacing: .05em; padding: 2px 7px; border-radius: 3px; color: var(--wp-text-muted, var(--wp-text2)); background: var(--wp-bg-deep, var(--wp-bg)); border: 1px solid var(--wp-border); }
.sm__lockcount { font: 600 9px var(--wp-font-sans); text-transform: uppercase; letter-spacing: .05em; padding: 2px 7px; border-radius: 3px; color: var(--wp-accent-text, var(--wp-text)); background: rgba(99,102,241,.12); border: 1px solid color-mix(in srgb, var(--wp-accent) 40%, transparent); }
.sm__bar-spacer { flex: 1; }
.ghost { padding: 4px 9px; border-radius: 3px; border: 1px solid var(--wp-border); background: transparent; color: var(--wp-text-muted, var(--wp-text2)); font: 11px var(--wp-font-sans); cursor: pointer; }
.ghost:hover { border-color: var(--wp-border-strong, var(--wp-border2)); color: var(--wp-text); }
.sm__hint { display: flex; align-items: center; gap: 7px; padding: 7px 14px; flex-shrink: 0; font: 11px var(--wp-font-sans); color: color-mix(in srgb, var(--wp-amber, #fbbf24) 75%, var(--wp-text-muted)); background: color-mix(in srgb, var(--wp-amber, #fbbf24) 9%, transparent); border-bottom: 1px solid var(--wp-border); }
.sm__hint svg { flex-shrink: 0; color: var(--wp-amber, #fbbf24); }
.sm__list { overflow-y: auto; padding: 6px; flex: 1; min-height: 0; }
.sm__foot { display: flex; align-items: center; gap: 12px; padding: 10px 14px; flex-shrink: 0; background: var(--wp-bg3); border-top: 1px solid var(--wp-border); }
.sm__foot-hint { font: 10px var(--wp-font-sans); color: var(--wp-text-dim, var(--wp-text3)); }
.sm__foot-hint kbd { font: 9px var(--wp-font-mono); background: var(--wp-bg-deep, var(--wp-bg)); border: 1px solid var(--wp-border); padding: 1px 4px; border-radius: 2px; }
.sm__foot-spacer { flex: 1; }
.btn { padding: 6px 14px; border: 1px solid var(--wp-accent); border-radius: 3px; background: var(--wp-accent); color: #fff; font: 11px var(--wp-font-sans); cursor: pointer; }
</style>
