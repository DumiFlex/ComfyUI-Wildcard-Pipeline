import { config } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { useDialogFocus } from "@/kit/useDialogFocus";

/**
 * The kit Drawer teleports to `body`, out of the test wrapper's reach, so the
 * chat drawer's suites draw it in place: the same panel, its `open` and
 * Escape (the kit's own `useDialogFocus`), without the Teleport.
 */
export const InlineDrawer = defineComponent({
  name: "Drawer",
  props: {
    open: { type: Boolean, required: true },
    modal: { type: Boolean, default: true },
    width: { type: String, default: "420px" },
  },
  emits: ["update:open"],
  setup(props, { slots, emit }) {
    const panel = ref<HTMLElement | null>(null);
    useDialogFocus(panel, () => props.open, {
      onEscape: () => emit("update:open", false),
      trap: () => props.modal,
    });
    return () => props.open
      ? h("aside", { ref: panel, class: "wp-drawer", role: "dialog" }, [
        h("div", { class: "wp-drawer__body" }, slots.default?.()),
      ])
      : null;
  },
});

/** Stub the Drawer for every mount in the calling test file. */
export function inlineDrawer(): void {
  config.global.stubs = { ...config.global.stubs, Drawer: InlineDrawer };
}
