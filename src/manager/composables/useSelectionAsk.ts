/**
 * Asking the chat about selected text: the "Explain" chip over a selection
 * (`AiSelectionChip.vue`), its Ctrl+Shift+X shortcut and the docs' "Ask the
 * assistant" button all go through here.
 */
import { nextTick } from "vue";
import { useAiChat } from "./useAiChat";

/** Longest selection sent; the rest is cut. */
export const MAX_SELECTION = 600;
/** Shortest selection the chip appears for. */
export const MIN_SELECTION = 2;
export const EXPLAIN_SHORTCUT = "Ctrl+Shift+X";

/** The selected text, whitespace collapsed, or "". */
export function selectedText(sel: Selection | null = window.getSelection?.() ?? null): string {
  return sel?.toString().replace(/\s+/g, " ").trim() ?? "";
}

function clip(text: string): string {
  return text.length > MAX_SELECTION ? `${text.slice(0, MAX_SELECTION).trimEnd()}…` : text;
}

export function explainPrompt(text: string): string {
  return `Explain this in simpler words: "${clip(text)}"`;
}

/** The start of a question about `text`, for the user to finish. */
export function askPrompt(text: string): string {
  return `About "${clip(text)}": `;
}

/** Whether `node` sits where selecting is for editing (inputs, text areas,
 *  rich editors), so the chip stays away. */
export function inEditable(node: Node | null): boolean {
  const el = node instanceof Element ? node : node?.parentElement ?? null;
  return !!el?.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [data-ai-no-explain]");
}

/** The current selection, when the chip may offer it, else "". */
export function askableSelection(sel: Selection | null = window.getSelection?.() ?? null): string {
  if (!sel || sel.isCollapsed || !sel.rangeCount) return "";
  if (inEditable(sel.anchorNode) || inEditable(sel.focusNode)) return "";
  const text = selectedText(sel);
  return text.length >= MIN_SELECTION ? text : "";
}

export function useSelectionAsk() {
  const chat = useAiChat();

  /** Send "Explain this…" for `text`. False when the chat is busy. */
  function explain(text: string): boolean {
    if (!text || chat.loading.value) return false;
    chat.ask(explainPrompt(text));
    return true;
  }

  /** Open the chat with the text quoted, for the user's own question. */
  function askAbout(text: string): void {
    if (!text) return;
    chat.input.value = askPrompt(text);
    chat.open.value = true;
    // An open drawer keeps its focus: put the caret after the quote.
    void nextTick(() => {
      const box = document.querySelector<HTMLTextAreaElement>(".wp-ai-chat__input");
      if (!box) return;
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    });
  }

  return { explain, askAbout };
}
