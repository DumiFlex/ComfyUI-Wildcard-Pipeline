<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, useSlots, watch } from "vue";
import Icon from "./Icon.vue";

interface Props {
  open: boolean;
  title?: string;
  size?: "sm" | "md" | "lg";
  closeOnBackdrop?: boolean;
}
const props = withDefaults(defineProps<Props>(), { size: "md", closeOnBackdrop: true });

const emit = defineEmits<{
  (e: "update:open", v: boolean): void;
}>();

const slots = useSlots();

const modalClasses = computed(() => ["wp-modal", `wp-modal--${props.size}`]);
const dialog = ref<HTMLElement | null>(null);
const titleId = `wp-modal-title-${useId()}`;
/** Where focus was before the modal opened: it goes back there on close. */
let returnTo: HTMLElement | null = null;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), '
  + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

function focusables(): HTMLElement[] {
  return Array.from(dialog.value?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    .filter((el) => !el.closest("[hidden], [inert]"));
}

function close() {
  emit("update:open", false);
}

function onBackdrop() {
  if (props.closeOnBackdrop) close();
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") { close(); return; }
  if (e.key !== "Tab" || !dialog.value) return;
  // Keep Tab inside the dialog: from the last control to the first and back.
  const els = focusables();
  if (!els.length) { e.preventDefault(); dialog.value.focus(); return; }
  const first = els[0];
  const last = els[els.length - 1];
  const at = document.activeElement;
  const inside = at instanceof Node && dialog.value.contains(at);
  if (e.shiftKey && (at === first || !inside)) { e.preventDefault(); last?.focus(); }
  else if (!e.shiftKey && (at === last || !inside)) { e.preventDefault(); first?.focus(); }
}

async function onOpen(): Promise<void> {
  returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  await nextTick();
  if (!dialog.value || dialog.value.contains(document.activeElement)) return;
  // The first control in the body, else the dialog itself (the close button
  // would make Enter close it).
  const body = dialog.value.querySelector(".wp-modal__body");
  const first = focusables().find((el) => body?.contains(el));
  (first ?? dialog.value).focus();
}

function onClosed(): void {
  const el = returnTo;
  returnTo = null;
  if (el?.isConnected) el.focus();
}

watch(() => props.open, (v, was) => {
  if (typeof window === "undefined") return;
  if (v) {
    window.addEventListener("keydown", onKeydown);
    void onOpen();
  } else {
    window.removeEventListener("keydown", onKeydown);
    if (was) onClosed();
  }
}, { immediate: true });

onBeforeUnmount(() => {
  if (typeof window === "undefined") return;
  window.removeEventListener("keydown", onKeydown);
  if (props.open) onClosed();
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="wp-modal__backdrop"
      data-test="modal-backdrop"
      @mousedown.self="onBackdrop"
    >
      <div
        ref="dialog"
        :class="modalClasses"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="title ? titleId : undefined"
        tabindex="-1"
        @mousedown.stop
      >
        <header v-if="title || slots.header" class="wp-modal__head">
          <h3 v-if="title" :id="titleId" class="wp-modal__title">{{ title }}</h3>
          <slot name="header" />
          <span class="wp-spacer" />
          <button
            type="button"
            class="wp-topbar__icon-btn"
            aria-label="Close"
            @click="close"
          >
            <Icon name="times" />
          </button>
        </header>
        <div class="wp-modal__body">
          <slot />
        </div>
        <footer v-if="slots.footer" class="wp-modal__foot">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>
