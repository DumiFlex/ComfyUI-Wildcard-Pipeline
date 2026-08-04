import { defineStore } from "pinia";
import { computed, ref } from "vue";

/**
 * engagementStore — how long someone has actually been using this, and whether
 * we have earned the right to ask them for anything.
 *
 * Only two things read it today: the what's-new card (has the version changed
 * since they last looked?) and the one-time GitHub star prompt.
 *
 * WHY IT COUNTS DAYS AND NOT ACTIONS
 *
 * The obvious triggers are all first-touch — "created 10 modules", "ran the
 * starter bundle", "first test run". Every one of them fires on someone who is
 * still poking at the thing: ten modules can be ten empty rows, and the
 * starter bundle is by definition the moment before you understand anything.
 * A first-touch trigger measures curiosity, not value.
 *
 * Coming BACK is the signal that cannot be faked by clicking around. So the
 * prompt needs both:
 *
 *   1. `activeDays >= MIN_ACTIVE_DAYS` — distinct calendar dates the manager
 *      was opened. Not sessions, because a reload is not a return; not
 *      consecutive, because life happens. Counting distinct dates also means
 *      the clock cannot be beaten in an afternoon.
 *   2. a library with substance — enough modules carrying enough real content
 *      that they are clearly building rather than exploring.
 *
 * Either alone is a false positive. Day five with an empty library is someone
 * still learning; a full library on day one is someone who imported a pack and
 * has not lived with it yet.
 *
 * PROMISES THIS STORE KEEPS
 *
 * Asked at most once. "Don't ask again" is permanent and survives upgrades.
 * Nothing here blocks anything, and no state is sent anywhere — it is all
 * local, and the point is to be quiet.
 */

const STORAGE_KEY = "wp-engagement-v1";

/** Distinct days with the manager open before the prompt is considered. */
export const MIN_ACTIVE_DAYS = 5;
/**
 * Days credited to someone who already had a real library the first time this
 * store ran — i.e. an existing user, upgrading into the feature.
 *
 * Without it, tracking starts at zero for everyone, so a person who has used
 * this for three months would wait another five days to be asked. That is
 * backwards: long-time users are the likeliest to star. A substantial library
 * on the very first recorded visit is itself evidence of prior use.
 *
 * It is a credit, not a free pass — deliberately short of the threshold, so
 * they still have to come back at least twice more. Being asked the instant
 * you update reads as a reward for updating, which is not the point.
 */
export const EXISTING_USER_CREDIT_DAYS = 3;
/**
 * How long "maybe later" holds.
 *
 * "Later" has to actually hide the card — otherwise clicking it does nothing
 * visible and the button is a lie. But it is not "no", so it expires. Long
 * enough that it never feels like the same ask twice in a week.
 */
export const SNOOZE_DAYS = 14;
/** Modules that actually contain something, before the prompt is considered. */
export const MIN_REAL_MODULES = 5;
/** Total options across the library — guards against five one-option stubs. */
export const MIN_TOTAL_OPTIONS = 20;

export type StarPromptState = "pending" | "later" | "done" | "never";

interface Engagement {
  /** ISO dates (YYYY-MM-DD) the manager was opened. Capped; see `noteVisit`. */
  days: string[];
  /** Where the star prompt stands. `done` and `never` are both terminal. */
  star: StarPromptState;
  /** Date "maybe later" was chosen, so the snooze can expire. */
  laterOn: string | null;
  /** Version whose what's-new card has already been seen. */
  seenVersion: string | null;
}

const EMPTY: Engagement = { days: [], star: "pending", laterOn: null, seenVersion: null };

function load(): Engagement {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<Engagement>;
    return {
      days: Array.isArray(parsed.days) ? parsed.days.filter((d) => typeof d === "string") : [],
      star: parsed.star === "later" || parsed.star === "done" || parsed.star === "never"
        ? parsed.star
        : "pending",
      laterOn: typeof parsed.laterOn === "string" ? parsed.laterOn : null,
      seenVersion: typeof parsed.seenVersion === "string" ? parsed.seenVersion : null,
    };
  } catch {
    // Denied or malformed storage behaves as a brand-new install, which is the
    // safe direction: we under-ask rather than over-ask.
    return { ...EMPTY };
  }
}

function save(state: Engagement): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage denied. The prompt simply never fires; nothing else depends on it.
  }
}

/** Local calendar date, not UTC — "days I used it" is a human notion. */
export function todayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Shape of what the library has to look like for the ask to be fair. */
export interface LibrarySubstance {
  realModules: number;
  totalOptions: number;
}

/**
 * Does this library show someone building rather than exploring?
 *
 * Mirrors the Dashboard's own "blank wildcard" rule — a module whose options
 * are absent or all-empty does not count, so ten placeholder rows never
 * qualify.
 */
export function measureSubstance(
  catalog: ReadonlyArray<{ payload?: unknown }>,
): LibrarySubstance {
  let realModules = 0;
  let totalOptions = 0;
  for (const m of catalog) {
    const opts = (m.payload as { options?: { value?: string }[] } | null)?.options ?? [];
    const real = opts.filter((o) => (o.value || "").trim().length > 0).length;
    if (real > 0) realModules += 1;
    totalOptions += real;
  }
  return { realModules, totalOptions };
}

export const useEngagementStore = defineStore("engagement", () => {
  const state = ref<Engagement>(load());

  const activeDays = computed(() => state.value.days.length);
  const starState = computed(() => state.value.star);

  /**
   * Credit an existing user, once, on the first visit this store ever sees.
   *
   * No-op afterwards: once there is any history, the real record governs.
   */
  function creditIfEstablished(substance: LibrarySubstance): void {
    if (state.value.days.length > 0) return;
    const established = substance.realModules >= MIN_REAL_MODULES
      && substance.totalOptions >= MIN_TOTAL_OPTIONS;
    if (!established) return;
    // Synthetic past dates: only the COUNT is ever read, and back-dating keeps
    // them distinct from today so the real visit still adds one.
    const days: string[] = [];
    for (let i = EXISTING_USER_CREDIT_DAYS; i >= 1; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(todayKey(d));
    }
    state.value = { ...state.value, days };
    save(state.value);
  }

  /** Record that the manager was opened today. Idempotent within a day. */
  function noteVisit(now: Date = new Date()): void {
    const key = todayKey(now);
    if (state.value.days.includes(key)) return;
    // Only the count matters, so keep the list short rather than growing a
    // record of someone's usage forever.
    const days = [...state.value.days, key].slice(-40);
    state.value = { ...state.value, days };
    save(state.value);
  }

  /** Whole days between two YYYY-MM-DD keys. */
  function daysBetween(from: string, to: string): number {
    const a = Date.parse(`${from}T00:00:00`);
    const b = Date.parse(`${to}T00:00:00`);
    if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
    return Math.round((b - a) / 86_400_000);
  }

  /**
   * Should the star prompt appear right now?
   *
   * `done` and `never` are terminal. `later` HIDES it — a button that does not
   * visibly do anything is a broken button — but only until the snooze
   * expires, because "later" is not "no".
   */
  function shouldAskForStar(substance: LibrarySubstance, now: Date = new Date()): boolean {
    if (state.value.star === "done" || state.value.star === "never") return false;
    if (state.value.star === "later") {
      const since = state.value.laterOn;
      if (!since) return false;
      if (daysBetween(since, todayKey(now)) < SNOOZE_DAYS) return false;
    }
    if (activeDays.value < MIN_ACTIVE_DAYS) return false;
    return substance.realModules >= MIN_REAL_MODULES
      && substance.totalOptions >= MIN_TOTAL_OPTIONS;
  }

  function setStarState(next: StarPromptState, now: Date = new Date()): void {
    state.value = {
      ...state.value,
      star: next,
      laterOn: next === "later" ? todayKey(now) : state.value.laterOn,
    };
    save(state.value);
  }

  /**
   * Record the running version the first time we ever see this user, so a
   * LATER upgrade has something to differ from.
   *
   * Without this the feature cannot fire at all: `hasUnseenRelease` needs a
   * previous version to compare against, and the only other writer is the
   * card's own dismiss button — which never renders until the card shows.
   * That is a closed loop with no entry point.
   *
   * Bootstrapping to the CURRENT version (rather than showing the card
   * immediately) is deliberate: at first run we have no idea which version
   * they were on before, and announcing "what's new" for a version they have
   * already been running is noise.
   */
  function bootstrapVersion(version: string | null): void {
    if (!version) return;
    if (state.value.seenVersion !== null) return;
    state.value = { ...state.value, seenVersion: version };
    save(state.value);
  }

  /** True when this version's what's-new has not been shown yet. Suppressed on
   *  a fresh install: a first-run user has no "new" to hear about. */
  function hasUnseenRelease(version: string | null): boolean {
    if (!version) return false;
    if (state.value.seenVersion === null) return false;
    return state.value.seenVersion !== version;
  }

  function markReleaseSeen(version: string | null): void {
    if (!version) return;
    state.value = { ...state.value, seenVersion: version };
    save(state.value);
  }

  /** @internal test hook */
  function _reset(next: Partial<Engagement> = {}): void {
    state.value = { ...EMPTY, ...next };
    save(state.value);
  }

  return {
    activeDays,
    starState,
    creditIfEstablished,
    noteVisit,
    shouldAskForStar,
    setStarState,
    bootstrapVersion,
    hasUnseenRelease,
    markReleaseSeen,
    _reset,
  };
});
