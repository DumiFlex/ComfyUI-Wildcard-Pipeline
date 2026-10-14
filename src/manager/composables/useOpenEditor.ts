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

/** A new item the chat proposed, waiting for its editor to open ("Open in
 *  editor" on a create card): the editor fills itself with it, unsaved. */
export interface StagedDraft {
  type: string;
  body: ModuleUpdateInput;
  /** A category the card would create; the editor can't pick it until it
   *  exists, so the editor says so. */
  newCategory?: string;
  /** The id the card reserved: Save creates the item at it, so other cards
   *  that already point at it (a constraint, a bundle, an @{id} ref) work. */
  id?: string;
  /** Called with the new id once Save created it: the card counts as
   *  applied. */
  onSaved?: (id: string) => void;
}
let staged: StagedDraft | null = null;

/** Hand a proposed new item to the editor about to open. */
export function stageDraft(draft: StagedDraft): void {
  staged = draft;
}

function write(spec: OpenEditorSpec, body: ModuleUpdateInput): void {
  if (body.name !== undefined) spec.name.value = body.name;
  if (body.description !== undefined) spec.description.value = body.description;
  if (body.tags !== undefined) spec.tags.value = [...body.tags];
  if (body.category_id !== undefined) spec.categoryId.value = body.category_id;
  if (body.content_rating !== undefined) spec.contentRating.value = body.content_rating;
  if (body.payload !== undefined && spec.setPayload) spec.setPayload(body.payload);
}

/** Register the mounted editor's item (call in setup). A new item has no
 *  id yet: it isn't registered, but gets back a function to call once the
 *  blank editor is ready, which fills it with a draft the chat staged for
 *  this type (returns that draft, or null). */
export function registerOpenEditor(spec: OpenEditorSpec): () => StagedDraft | null {
  if (!spec.id) {
    return () => {
      const draft = staged;
      if (!draft || draft.type !== spec.type) return null;
      staged = null;
      write(spec, draft.body);
      return draft;
    };
  }
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
    write: (body) => write(spec, body),
  };
  editor.value = entry;
  onBeforeUnmount(() => {
    if (editor.value === entry) editor.value = null;
  });
  return () => null;
}

/** What a new-item editor's create call adds for a draft from the chat:
 *  the reserved id, so the item lands where other cards expect it. */
export function draftCreateId(d: StagedDraft | null | undefined): { id?: string } {
  return d?.id ? { id: d.id } : {};
}

/** Tell the chat its draft was saved (Save = Apply). */
export function draftSaved(d: StagedDraft | null | undefined, id: string | undefined): void {
  if (d && id) d.onSaved?.(id);
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
  staged = null;
  editor.value = null;
  pageNote.value = null;
}
