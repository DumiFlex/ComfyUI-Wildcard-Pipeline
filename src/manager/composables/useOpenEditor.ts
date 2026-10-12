/**
 * What the AI chat can see of the current page, and the open editor it can
 * change.
 *
 * An editor registers its item while it is mounted: the chat reads the
 * editor's version (unsaved changes included) and puts its changes to that
 * item into the editor, where Save keeps them, instead of writing the saved
 * row behind the editor's back. Any view can register a short note saying
 * what it shows (filters, selection, results) so "these" and "this" mean
 * what's on screen. Both are single slots, cleared on unmount.
 */
import { onBeforeUnmount, shallowRef, type Ref } from "vue";
import type { AiChatEditorState, ModuleUpdateInput } from "../api/types";

export interface OpenEditor {
  id: string;
  type: string;
  read(): AiChatEditorState;
  /** Put changes into the editor's draft. */
  write(body: ModuleUpdateInput): void;
}

export interface OpenEditorSpec {
  id: string | undefined;
  type: string;
  dirty: () => boolean;
  name: Ref<string>;
  description: Ref<string>;
  tags: Ref<string[]>;
  categoryId: Ref<string | null>;
  contentRating: Ref<"safe" | "nsfw">;
  /** The payload as Save would store it. Leave out to share only the info. */
  payload?: () => Record<string, unknown>;
  setPayload?: (payload: Record<string, unknown>) => void;
}

const editor = shallowRef<OpenEditor | null>(null);
const pageNote = shallowRef<(() => string) | null>(null);

/** Register the mounted editor's item (call in setup). New items have no id
 *  yet and aren't registered. */
export function registerOpenEditor(spec: OpenEditorSpec): void {
  if (!spec.id) return;
  const id = spec.id;
  const entry: OpenEditor = {
    id,
    type: spec.type,
    read: () => ({
      id,
      name: spec.name.value,
      description: spec.description.value,
      tags: [...spec.tags.value],
      category_id: spec.categoryId.value,
      content_rating: spec.contentRating.value,
      ...(spec.payload ? { payload: spec.payload() } : {}),
      dirty: spec.dirty(),
    }),
    write: (body) => {
      if (body.name !== undefined) spec.name.value = body.name;
      if (body.description !== undefined) spec.description.value = body.description;
      if (body.tags !== undefined) spec.tags.value = [...body.tags];
      if (body.category_id !== undefined) spec.categoryId.value = body.category_id;
      if (body.content_rating !== undefined) spec.contentRating.value = body.content_rating;
      if (body.payload !== undefined && spec.setPayload) spec.setPayload(body.payload);
    },
  };
  editor.value = entry;
  onBeforeUnmount(() => {
    if (editor.value === entry) editor.value = null;
  });
}

/** Register what the current view shows, as a short line or two. */
export function registerPageNote(note: () => string): void {
  pageNote.value = note;
  onBeforeUnmount(() => {
    if (pageNote.value === note) pageNote.value = null;
  });
}

export function openEditor(): OpenEditor | null {
  return editor.value;
}

export function currentPageNote(): string {
  try {
    return pageNote.value?.().trim() ?? "";
  } catch {
    return "";
  }
}

/** Test seam. */
export function _resetOpenEditorForTests(): void {
  editor.value = null;
  pageNote.value = null;
}
