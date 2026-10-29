<script setup lang="ts">
/**
 * Timeline: events in order, each a dot on one line with its time, title
 * and an optional body (History, an AI trace, a pack build log). Works on
 * the canvas and in the manager.
 *
 *   <Timeline :items="[{ id: 1, title: 'Saved Hair colour', time: '5 min ago', tone: 'success', icon: 'pi-check' }]" />
 *   <Timeline :items="steps"><template #body="{ item }"><CodeBlock :code="item.args" bare /></template></Timeline>
 *
 * It is an ordered list. `#body` and `#time` slots let a screen draw its own
 * body (a diff, a code block) or a RelativeDate. The last item can be
 * `pending` (a pulsing dot) while a job is still running.
 */
export interface TimelineItem {
  id: string | number;
  title: string;
  /** Shown after the title, e.g. "5 min ago". */
  time?: string | undefined;
  /** A line or two of text under the title. */
  body?: string | undefined;
  tone?: "neutral" | "info" | "success" | "warn" | "danger" | "accent" | undefined;
  /** A PrimeIcons class inside the dot. */
  icon?: string | undefined;
  /** Still running: the dot pulses. */
  pending?: boolean | undefined;
}

withDefaults(defineProps<{
  items: TimelineItem[];
  size?: "sm" | "md" | undefined;
  ariaLabel?: string | undefined;
}>(), { size: "md", ariaLabel: undefined });
</script>

<template>
  <ol class="wp-timeline" :data-size="size" :aria-label="ariaLabel">
    <li
      v-for="it in items"
      :key="it.id"
      class="wp-timeline__item"
      :data-tone="it.tone ?? 'neutral'"
      :data-pending="it.pending || undefined"
      :data-icon="it.icon ? 'true' : undefined"
    >
      <span class="wp-timeline__dot" aria-hidden="true"><i v-if="it.icon" class="pi" :class="it.icon" /></span>
      <div class="wp-timeline__main">
        <div class="wp-timeline__head">
          <span class="wp-timeline__title">{{ it.title }}</span>
          <span v-if="it.time || $slots.time" class="wp-timeline__time"><slot name="time" :item="it">{{ it.time }}</slot></span>
        </div>
        <div v-if="it.body || $slots.body" class="wp-timeline__body"><slot name="body" :item="it">{{ it.body }}</slot></div>
      </div>
    </li>
  </ol>
</template>

<style scoped>
.wp-timeline { --_dot: 20px; margin: 0; padding: 0; list-style: none; font: 400 var(--wp-text-sm)/1.45 var(--wp-font-sans); min-width: 0; }
.wp-timeline[data-size="sm"] { --_dot: 16px; font-size: var(--wp-text-xs); }
.wp-timeline__item { --_tone: var(--wp-text-dim); position: relative; display: flex; gap: var(--wp-space-4); padding-bottom: var(--wp-space-5); }
.wp-timeline[data-size="sm"] .wp-timeline__item { gap: var(--wp-space-3); padding-bottom: var(--wp-space-4); }
.wp-timeline__item:last-child { padding-bottom: 0; }
.wp-timeline__item[data-tone="info"] { --_tone: var(--wp-info); }
.wp-timeline__item[data-tone="success"] { --_tone: var(--wp-success); }
.wp-timeline__item[data-tone="warn"] { --_tone: var(--wp-warn); }
.wp-timeline__item[data-tone="danger"] { --_tone: var(--wp-danger); }
.wp-timeline__item[data-tone="accent"] { --_tone: var(--wp-accent); }
.wp-timeline__item:not(:last-child)::before {
  content: ""; position: absolute; top: calc(var(--_dot) + 2px); bottom: 2px; left: calc(var(--_dot) / 2 - 1px);
  width: 2px; border-radius: min(1px, var(--wp-radius-cap, 999px)); background: var(--wp-border);
}
.wp-timeline__dot {
  position: relative; display: grid; place-items: center; flex: none; box-sizing: border-box;
  width: var(--_dot); height: var(--_dot); margin-top: 1px; border-radius: 50%; /* round: timeline dot */
  border: 2px solid var(--_tone); background: var(--wp-bg-1); color: var(--_tone);
}
.wp-timeline__item:not([data-icon]) .wp-timeline__dot { transform: scale(0.6); background: var(--_tone); }
.wp-timeline__dot .pi { font-size: calc(var(--_dot) * 0.45); }
.wp-timeline__item[data-pending] .wp-timeline__dot::after {
  content: ""; position: absolute; inset: -4px; border-radius: 50%; /* round: timeline dot ring */ border: 2px solid var(--_tone);
  animation: wp-timeline-pulse 1.6s ease-out infinite;
}
@keyframes wp-timeline-pulse { from { opacity: 0.7; transform: scale(0.8); } to { opacity: 0; transform: scale(1.4); } }
.wp-timeline__main { flex: 1; min-width: 0; }
.wp-timeline__head { display: flex; align-items: baseline; gap: var(--wp-space-3); flex-wrap: wrap; }
.wp-timeline__title { color: var(--wp-text); font-weight: 500; }
.wp-timeline__time { color: var(--wp-text-dim); font-size: var(--wp-text-xs); font-variant-numeric: tabular-nums; }
.wp-timeline__body { margin-top: 2px; color: var(--wp-text-muted); overflow-wrap: anywhere; }
@media (prefers-reduced-motion: reduce) {
  .wp-timeline__item[data-pending] .wp-timeline__dot::after { animation: none; display: none; }
}
</style>
