import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import {
  useEngagementStore,
  measureSubstance,
  todayKey,
  MIN_ACTIVE_DAYS,
  SNOOZE_DAYS,
  EXISTING_USER_CREDIT_DAYS,
} from "../../stores/engagementStore";

/**
 * The eligibility rule is the whole feature — if it fires early it is adware,
 * and if it never fires it is dead code. These pin both edges.
 */
const RICH = { realModules: 8, totalOptions: 40 };

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

describe("engagementStore — visits", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it("counts a day once, however many times the manager is opened", () => {
    const s = useEngagementStore();
    const now = new Date();
    s.noteVisit(now);
    s.noteVisit(now);
    s.noteVisit(now);
    expect(s.activeDays).toBe(1);
  });

  it("counts distinct days, and does not require them to be consecutive", () => {
    const s = useEngagementStore();
    s.noteVisit(daysAgo(30));
    s.noteVisit(daysAgo(12));
    s.noteVisit(new Date());
    expect(s.activeDays).toBe(3);
  });
});

describe("engagementStore — when we may ask for a star", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  function withDays(n: number) {
    const s = useEngagementStore();
    for (let i = 0; i < n; i++) s.noteVisit(daysAgo(n - i));
    return s;
  }

  it("stays quiet before the day threshold, however rich the library", () => {
    const s = withDays(MIN_ACTIVE_DAYS - 1);
    expect(s.shouldAskForStar(RICH)).toBe(false);
  });

  it("stays quiet on an empty library, however many days", () => {
    const s = withDays(MIN_ACTIVE_DAYS + 10);
    expect(s.shouldAskForStar({ realModules: 0, totalOptions: 0 })).toBe(false);
  });

  it("stays quiet for ten placeholder modules — the case that killed 'created N modules'", () => {
    const s = withDays(MIN_ACTIVE_DAYS + 3);
    // Ten modules exist, but nothing inside them: measureSubstance sees none.
    const empty = measureSubstance(
      Array.from({ length: 10 }, () => ({ payload: { options: [{ value: "  " }] } })),
    );
    expect(empty.realModules).toBe(0);
    expect(s.shouldAskForStar(empty)).toBe(false);
  });

  it("stays quiet for a handful of one-option stubs", () => {
    const s = withDays(MIN_ACTIVE_DAYS + 3);
    expect(s.shouldAskForStar({ realModules: 6, totalOptions: 6 })).toBe(false);
  });

  it("asks once both the return signal and the content signal hold", () => {
    const s = withDays(MIN_ACTIVE_DAYS);
    expect(s.shouldAskForStar(RICH)).toBe(true);
  });

  it("never asks again after 'don't ask again'", () => {
    const s = withDays(MIN_ACTIVE_DAYS + 20);
    s.setStarState("never");
    expect(s.shouldAskForStar(RICH)).toBe(false);
  });

  it("never asks again once they have starred", () => {
    const s = withDays(MIN_ACTIVE_DAYS + 20);
    s.setStarState("done");
    expect(s.shouldAskForStar(RICH)).toBe(false);
  });

  it("'maybe later' hides it immediately — a button that does nothing is broken", () => {
    const s = withDays(MIN_ACTIVE_DAYS + 2);
    expect(s.shouldAskForStar(RICH)).toBe(true);
    s.setStarState("later");
    expect(s.shouldAskForStar(RICH)).toBe(false);
  });

  it("'maybe later' is still hidden the next day", () => {
    const s = withDays(MIN_ACTIVE_DAYS + 2);
    s.setStarState("later");
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(s.shouldAskForStar(RICH, tomorrow)).toBe(false);
  });

  it("'maybe later' expires, because later is not no", () => {
    const s = withDays(MIN_ACTIVE_DAYS + 2);
    s.setStarState("later");
    const after = new Date();
    after.setDate(after.getDate() + SNOOZE_DAYS + 1);
    expect(s.shouldAskForStar(RICH, after)).toBe(true);
  });

  it("'don't ask again' never expires", () => {
    const s = withDays(MIN_ACTIVE_DAYS + 2);
    s.setStarState("never");
    const muchLater = new Date();
    muchLater.setDate(muchLater.getDate() + 400);
    expect(s.shouldAskForStar(RICH, muchLater)).toBe(false);
  });

  it("survives a reload — the decision is persisted, not per-session", () => {
    const first = useEngagementStore();
    for (let i = 0; i < MIN_ACTIVE_DAYS; i++) first.noteVisit(daysAgo(i));
    first.setStarState("never");

    setActivePinia(createPinia());
    const reloaded = useEngagementStore();
    expect(reloaded.shouldAskForStar(RICH)).toBe(false);
  });
});

describe("measureSubstance", () => {
  it("ignores whitespace-only options", () => {
    const out = measureSubstance([{ payload: { options: [{ value: " " }, { value: "\t" }] } }]);
    expect(out).toEqual({ realModules: 0, totalOptions: 0 });
  });

  it("counts a module once but its options individually", () => {
    const out = measureSubstance([
      { payload: { options: [{ value: "a" }, { value: "b" }, { value: "" }] } },
      { payload: { options: [{ value: "c" }] } },
    ]);
    expect(out).toEqual({ realModules: 2, totalOptions: 3 });
  });

  it("tolerates modules with no payload at all", () => {
    expect(measureSubstance([{}, { payload: null }])).toEqual({ realModules: 0, totalOptions: 0 });
  });
});

describe("engagementStore — what's new", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it("says nothing on a fresh install — there is no 'new' to report", () => {
    const s = useEngagementStore();
    expect(s.hasUnseenRelease("2.12.0")).toBe(false);
  });

  it("reports a change once a version has been recorded", () => {
    const s = useEngagementStore();
    s.markReleaseSeen("2.11.0");
    expect(s.hasUnseenRelease("2.12.0")).toBe(true);
    expect(s.hasUnseenRelease("2.11.0")).toBe(false);
  });

  it("stops reporting after the card is seen", () => {
    const s = useEngagementStore();
    s.markReleaseSeen("2.11.0");
    s.markReleaseSeen("2.12.0");
    expect(s.hasUnseenRelease("2.12.0")).toBe(false);
  });
});

describe("todayKey", () => {
  it("uses the local calendar date, not UTC", () => {
    // 23:30 local on the 5th is still the 5th, even where UTC has rolled over.
    const d = new Date(2026, 7, 5, 23, 30);
    expect(todayKey(d)).toBe("2026-08-05");
  });
});

describe("engagementStore — users who were already here", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it("credits an established library, so a long-time user is not sent to the back of the queue", () => {
    const s = useEngagementStore();
    s.creditIfEstablished(RICH);
    expect(s.activeDays).toBe(EXISTING_USER_CREDIT_DAYS);
  });

  it("still makes them come back — the credit is short of the threshold", () => {
    const s = useEngagementStore();
    s.creditIfEstablished(RICH);
    s.noteVisit();
    expect(s.shouldAskForStar(RICH)).toBe(false);
    expect(EXISTING_USER_CREDIT_DAYS).toBeLessThan(MIN_ACTIVE_DAYS);
  });

  it("credits nothing to a new user with an empty library", () => {
    const s = useEngagementStore();
    s.creditIfEstablished({ realModules: 1, totalOptions: 2 });
    expect(s.activeDays).toBe(0);
  });

  it("never re-credits once any history exists", () => {
    const s = useEngagementStore();
    s.noteVisit();
    s.creditIfEstablished(RICH);
    expect(s.activeDays).toBe(1);
  });
});
