import { computed, onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from "vue";

const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DRAFT_DEBOUNCE_MS = 2000;

/** Format a millisecond age as a short "X ago" string for the draft banner.
 *  Shared so all 6 editors render identical age strings without redeclaring
 *  the same 10-line helper. */
export function formatDraftAge(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "just now";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export interface EditorDraftOptions {
  kind: string;
  id: string;
  dirty: Ref<boolean>;
  snapshot: () => string;
  /** Injectable for tests. Defaults to window.localStorage. */
  storage?: Storage | null;
}

interface StoredDraft { snapshot: string; savedAt: string; }

export interface EditorDraft {
  hasDraft: ComputedRef<boolean>;
  draftAge: ComputedRef<number | null>;
  draftSnapshot: ComputedRef<string | null>;
  restore: () => string | null;
  discard: () => void;
}

function defaultStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage; } catch { return null; }
}

/**
 * localStorage-backed draft autosave for the editor surface.
 *
 *   - Debounces writes (2s after the last dirty mutation) so rapid keystrokes
 *     don't hammer storage.
 *   - Key format: `wp-draft-<kind>-<id>`.
 *   - Drafts older than 7 days are auto-discarded on read.
 *   - On storage write failure (private mode, quota exceeded) the composable
 *     silently disables further writes — the user never sees draft-related
 *     errors because drafts aren't critical functionality.
 *   - The composable does NOT auto-apply drafts. Editors decide when/how to
 *     surface the banner and call `restore()` on user opt-in.
 */
export function useEditorDraft(opts: EditorDraftOptions): EditorDraft {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const key = `wp-draft-${opts.kind}-${opts.id}`;
  const disabled = ref(false);

  function readStored(): StoredDraft | null {
    if (!storage) return null;
    try {
      const raw = storage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<StoredDraft>;
      if (typeof parsed?.snapshot !== "string" || typeof parsed?.savedAt !== "string") return null;
      const age = Date.now() - Date.parse(parsed.savedAt);
      if (!Number.isFinite(age) || age > DRAFT_TTL_MS) {
        try { storage.removeItem(key); } catch { /* ignore */ }
        return null;
      }
      return parsed as StoredDraft;
    } catch {
      return null;
    }
  }

  /** Bootstrap-time draft snapshot — only the draft that existed when
   *  the composable mounted drives `hasDraft`. Subsequent persist() calls
   *  during this session DO NOT flip the banner back on. Without this
   *  distinction the user sees "Unsaved draft from 0s ago" appear while
   *  they're actively typing, which makes no sense. */
  const bootstrap = ref<StoredDraft | null>(readStored());

  function persist(): void {
    if (disabled.value || !storage) return;
    try {
      const payload: StoredDraft = { snapshot: opts.snapshot(), savedAt: new Date().toISOString() };
      storage.setItem(key, JSON.stringify(payload));
      // Note: deliberately NOT updating `bootstrap` here — the banner
      // is bound to bootstrap, so persisting during the active session
      // stays invisible. Reload re-reads via readStored() on next mount.
    } catch {
      disabled.value = true;
    }
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(persist, DRAFT_DEBOUNCE_MS);
  }

  watch(
    () => [opts.dirty.value, opts.dirty.value ? opts.snapshot() : null],
    () => { if (opts.dirty.value) schedule(); },
  );

  onBeforeUnmount(() => { if (timer) clearTimeout(timer); });

  const hasDraft = computed<boolean>(() => bootstrap.value !== null);
  const draftAge = computed<number | null>(() =>
    bootstrap.value ? Date.now() - Date.parse(bootstrap.value.savedAt) : null,
  );
  const draftSnapshot = computed<string | null>(() => bootstrap.value?.snapshot ?? null);

  function restore(): string | null {
    const snap = bootstrap.value?.snapshot ?? null;
    discard();
    return snap;
  }

  function discard(): void {
    if (storage) try { storage.removeItem(key); } catch { /* ignore */ }
    bootstrap.value = null;
  }

  return { hasDraft, draftAge, draftSnapshot, restore, discard };
}
