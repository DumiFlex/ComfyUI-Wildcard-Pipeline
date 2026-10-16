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
 *
 * A new, never-saved item registers too, under an id reserved for it when
 * the editor opens (the id of the chat card it was opened from, if any,
 * else a fresh 8-hex one), with `isNew` set. The chat reads it and fills
 * it like a saved one; nothing exists on the server until the user saves.
 * Once the chat has read it, Save creates the item AT that id
 * (`draftCreateId`), so cards that already point at it (a constraint, a
 * bundle child, an @{id} ref) still work.
 */
import { onBeforeUnmount, shallowRef, type Ref } from "vue";
import type { AiChatEditorState, ModuleUpdateInput } from "../api/types";
import { newShortId } from "../utils/ids";

export interface OpenEditor {
  id: string;
  type: string;
  /** A new item, not saved yet: `id` is only reserved for it. */
  isNew?: boolean;
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
  /** Called when its editor closes without saving it (the user left the
   *  page and discarded): the card is waiting again. */
  onClosed?: () => void;
}
/** Drafts whose editor saved them, so closing that editor isn't a discard. */
const savedDrafts = new WeakSet<StagedDraft>();
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

/** The new item's editor, while one is registered, and whether the chat
 *  has read it (then Save creates the item at its reserved id). */
let fresh: { entry: OpenEditor; read: boolean } | null = null;

/** Register the mounted editor's item (call in setup). Returns a function
 *  a new item's editor calls once its blank form is ready: it fills the
 *  form with a draft the chat staged for this type (returns that draft,
 *  or null). A saved item's editor gets a no-op. */
export function registerOpenEditor(spec: OpenEditorSpec): () => StagedDraft | null {
  const isNew = !spec.id;
  const entry: OpenEditor = {
    id: spec.id ?? newShortId(),
    type: spec.type,
    ...(isNew ? { isNew: true } : {}),
    read: () => {
      if (fresh?.entry === entry) fresh.read = true;
      return {
        id: entry.id,
        ...(isNew ? { new: true, type: spec.type } : {}),
        name: spec.name.value,
        description: spec.description.value,
        tags: [...spec.tags.value],
        category_id: spec.categoryId.value,
        content_rating: spec.contentRating.value,
        ...(spec.payload ? { payload: spec.payload() } : {}),
        dirty: spec.dirty(),
      };
    },
    write: (body) => write(spec, body),
  };
  editor.value = entry;
  if (isNew) fresh = { entry, read: false };
  let taken: StagedDraft | null = null;
  onBeforeUnmount(() => {
    if (editor.value === entry) editor.value = null;
    if (fresh?.entry === entry) fresh = null;
    if (taken && !savedDrafts.has(taken)) taken.onClosed?.();
  });
  if (!isNew) return () => null;
  return () => {
    const draft = staged;
    if (!draft || draft.type !== spec.type) return null;
    staged = null;
    taken = draft;
    // The card's reserved id is the one other cards point at.
    if (draft.id) entry.id = draft.id;
    write(spec, draft.body);
    return draft;
  };
}

/** What a new-item editor's create call adds: the id a chat card reserved,
 *  or the one the open new item was registered under once the chat has
 *  read it, so the item lands where the chat's other cards expect it. */
export function draftCreateId(d: StagedDraft | null | undefined): { id?: string } {
  if (d?.id) return { id: d.id };
  return fresh?.read ? { id: fresh.entry.id } : {};
}

/** The open editor's item for the chat request on a page showing item
 *  `routeId` (the route's id): a saved item open on its own page, or a new
 *  item (which has no route id). */
export function editorForPage(routeId: string | undefined): AiChatEditorState | undefined {
  const ed = editor.value;
  if (!ed) return undefined;
  if (ed.isNew ? !routeId : ed.id === routeId) return ed.read();
  return undefined;
}

/** Tell the chat its draft was saved (Save = Apply). */
export function draftSaved(d: StagedDraft | null | undefined, id: string | undefined): void {
  if (d && id) {
    savedDrafts.add(d);
    d.onSaved?.(id);
  }
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
  fresh = null;
  editor.value = null;
  pageNote.value = null;
}
