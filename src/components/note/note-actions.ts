/**
 * What a note's action buttons need from the canvas, handed down from the
 * note widget to its Markdown (and the editor's Preview). Without it (the
 * label hover card) an action button shows but stays switched off.
 */
import type { InjectionKey, Ref } from "vue";

export interface LibraryButtonState {
  /** Something to add or a clash to settle. */
  ready: boolean;
  /** The button's tooltip: what pressing it does, or why it can't. */
  hint: string;
}

export interface NoteActions {
  /** The state of a `wp:library` button for `node` ("" = the workflow).
   *  Reading it inside a render tracks the library and the canvas. */
  library(node: string): LibraryButtonState;
  runLibrary(node: string): void;
}

export const NOTE_ACTIONS: InjectionKey<NoteActions> = Symbol("wp-note-actions");

/** The WP Contexts a link can name, for the editor's picker. */
export interface ContextChoice { value: string; label: string }
export const NOTE_CONTEXTS: InjectionKey<Ref<ContextChoice[]>> = Symbol("wp-note-contexts");
