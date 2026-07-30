<script setup lang="ts">
/**
 * FeedbackModal — where to send a bug report or a feature request.
 *
 * Covers BOTH: the entry point is deliberately not called "Report an issue",
 * because most of what users want to send is "could it also do X". Two routes,
 * Discord first — it gets a faster answer and is more likely to be seen, which
 * the copy says outright rather than leaving the user to guess which to pick.
 */
import Modal from "./ui/Modal.vue";
import { DISCORD_INVITE, GITHUB_NEW_ISSUE } from "../config/links";

defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [v: boolean] }>();
</script>

<template>
  <Modal
    :open="open"
    title="Feedback &amp; support"
    data-test="feedback-modal"
    @update:open="(v: boolean) => emit('update:open', v)"
  >
    <p class="wp-fb__lede">
      Found a bug, or want the extension to do something it doesn't yet?
      Either route works — Discord usually gets a reply sooner.
    </p>

    <div class="wp-fb__routes">
      <a
        :href="DISCORD_INVITE"
        target="_blank"
        rel="noopener noreferrer"
        class="wp-fb__route wp-fb__route--primary"
        data-test="feedback-discord"
      >
        <i class="pi pi-discord wp-fb__icon" aria-hidden="true" />
        <span class="wp-fb__body">
          <span class="wp-fb__title">Discord
            <span class="wp-fb__badge">fastest</span>
          </span>
          <span class="wp-fb__sub">
            Ask, report, or suggest in the open. Good for anything that needs a
            back-and-forth, or when you're not sure it's a bug.
          </span>
        </span>
      </a>

      <a
        :href="GITHUB_NEW_ISSUE"
        target="_blank"
        rel="noopener noreferrer"
        class="wp-fb__route"
        data-test="feedback-github"
      >
        <i class="pi pi-github wp-fb__icon" aria-hidden="true" />
        <span class="wp-fb__body">
          <span class="wp-fb__title">GitHub issue</span>
          <span class="wp-fb__sub">
            Best for a reproducible bug or a concrete feature request — it gets
            tracked and stays linked to the fix.
          </span>
        </span>
      </a>
    </div>

    <p class="wp-fb__hint">
      For a bug, the most useful things to include: what you did, what you
      expected, your ComfyUI + extension versions, and any red text from the
      browser console.
    </p>
  </Modal>
</template>

<style scoped>
.wp-fb__lede {
  margin: 0 0 var(--wp-space-5);
  font-size: var(--wp-text-sm);
  color: var(--wp-text-muted);
}
.wp-fb__routes {
  display: flex;
  flex-direction: column;
  gap: var(--wp-space-4);
}
.wp-fb__route {
  display: flex;
  align-items: flex-start;
  gap: var(--wp-space-4);
  padding: var(--wp-space-4);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius);
  background: var(--wp-bg-2);
  text-decoration: none;
  color: var(--wp-text);
}
.wp-fb__route:hover {
  border-color: var(--wp-accent);
  background: color-mix(in oklab, var(--wp-accent) 8%, var(--wp-bg-2));
}
.wp-fb__route--primary { border-color: color-mix(in oklab, var(--wp-accent) 45%, transparent); }
.wp-fb__icon {
  font-size: 18px;
  color: var(--wp-accent-text, var(--wp-accent));
  margin-top: 1px;
}
.wp-fb__body { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.wp-fb__title {
  display: flex;
  align-items: center;
  gap: var(--wp-space-3);
  font-weight: 600;
  font-size: var(--wp-text-sm);
}
.wp-fb__badge {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 1px 6px;
  border-radius: 999px;
  color: var(--wp-accent-text, var(--wp-accent));
  background: color-mix(in oklab, var(--wp-accent) 18%, transparent);
}
.wp-fb__sub {
  font-size: var(--wp-text-xs);
  color: var(--wp-text-muted);
  line-height: 1.5;
}
.wp-fb__hint {
  margin: var(--wp-space-5) 0 0;
  font-size: var(--wp-text-xs);
  color: var(--wp-text-dim);
  line-height: 1.5;
}
</style>
