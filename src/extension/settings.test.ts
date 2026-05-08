// Tests for src/extension/settings.ts — verifies the four critical paths of
// the ComfyUI a11y settings: boot state, live updates from system pref, the
// explicit-override-beats-system rule, and matchMedia listener teardown
// (the last is the kind of leak that surfaces only after HMR cycles).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  applyA11yClasses,
  applyDisplayPrefs,
  watchA11ySystemPrefs,
  buildSettings,
  getCollapsedByDefault,
  installDebugHelpers,
  markBootCompleted,
  _resetBootForTesting,
  _resetDisplayStateForTesting,
} from "./settings";
import { toasts } from "../components/shared/toast-store";

const MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const CONTRAST_QUERY = "(prefers-contrast: more)";
const SETTING_MOTION = "wildcardPipeline.a11y.reduceMotion";
const SETTING_CONTRAST = "wildcardPipeline.a11y.contrast";
const SETTING_DENSITY = "wildcardPipeline.display.density";
const SETTING_DECORATION = "wildcardPipeline.display.decoration";
const SETTING_INDICATOR = "wildcardPipeline.display.indicatorStyle";
const SETTING_BORDER = "wildcardPipeline.display.borderHighlight";
const SETTING_COLLAPSED = "wildcardPipeline.display.collapsedByDefault";
const SETTING_FOCUS = "wildcardPipeline.display.focusMode";

interface FakeMQL {
  matches: boolean;
  media: string;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  _trigger: (newMatches: boolean) => void;
}

interface MatchMediaFixture {
  factory: ReturnType<typeof vi.fn>;
  mqs: Record<string, FakeMQL>;
}

/**
 * Builds a controllable matchMedia mock. `_trigger` simulates an OS preference
 * flip so we can verify the auto-mode listener path without poking real
 * system settings.
 */
function makeMatchMedia(initial: { motion: boolean; contrast: boolean }): MatchMediaFixture {
  const mqs: Record<string, FakeMQL> = {};
  const factory = vi.fn((query: string): FakeMQL => {
    if (mqs[query]) return mqs[query];
    let listener: ((ev: { matches: boolean }) => void) | null = null;
    const startMatches = query === MOTION_QUERY ? initial.motion
      : query === CONTRAST_QUERY ? initial.contrast
      : false;
    const mql: FakeMQL = {
      matches: startMatches,
      media: query,
      addEventListener: vi.fn((_event: string, cb: (ev: { matches: boolean }) => void) => {
        listener = cb;
      }),
      removeEventListener: vi.fn(() => {
        listener = null;
      }),
      _trigger: (newMatches: boolean) => {
        mql.matches = newMatches;
        listener?.({ matches: newMatches });
      },
    };
    mqs[query] = mql;
    return mql;
  });
  return { factory, mqs };
}

interface FakeApp {
  extensionManager: { setting: { get: (id: string) => unknown } };
}

function makeApp(motion = "auto", contrast = "auto"): FakeApp {
  return {
    extensionManager: {
      setting: {
        get: (id: string) => {
          if (id === SETTING_MOTION) return motion;
          if (id === SETTING_CONTRAST) return contrast;
          return undefined;
        },
      },
    },
  };
}

interface DisplayOverrides {
  density?: string;
  decoration?: string;
  indicatorStyle?: string;
  borderHighlight?: boolean;
  collapsedByDefault?: boolean;
  focusMode?: boolean;
}

function makeAppWithDisplay(overrides: DisplayOverrides = {}): FakeApp {
  return {
    extensionManager: {
      setting: {
        get: (id: string) => {
          if (id === SETTING_MOTION) return "auto";
          if (id === SETTING_CONTRAST) return "auto";
          if (id === SETTING_DENSITY) return overrides.density ?? "comfortable";
          if (id === SETTING_DECORATION) return overrides.decoration ?? "full";
          if (id === SETTING_INDICATOR) return overrides.indicatorStyle ?? "dot";
          if (id === SETTING_BORDER) return overrides.borderHighlight ?? true;
          if (id === SETTING_COLLAPSED) return overrides.collapsedByDefault ?? false;
          if (id === SETTING_FOCUS) return overrides.focusMode ?? false;
          return undefined;
        },
      },
    },
  };
}

describe("a11y settings", () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    document.body.className = "";
    toasts.value = [];
    _resetBootForTesting();
    _resetDisplayStateForTesting();
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    document.body.className = "";
  });

  it("boot — applyA11yClasses reads explicit setting and flips body class", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;

    applyA11yClasses(makeApp("on", "auto"));

    expect(document.body.classList.contains("wp-a11y-no-motion")).toBe(true);
    expect(document.body.classList.contains("wp-a11y-high-contrast")).toBe(false);
  });

  it("boot + auto — picks up system pref via matchMedia", () => {
    const fixture = makeMatchMedia({ motion: true, contrast: true });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;

    applyA11yClasses(makeApp("auto", "auto"));

    expect(document.body.classList.contains("wp-a11y-no-motion")).toBe(true);
    expect(document.body.classList.contains("wp-a11y-high-contrast")).toBe(true);
  });

  it("live update — auto mode flips marker when system pref change event fires", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;

    applyA11yClasses(makeApp("auto", "auto"));
    const teardown = watchA11ySystemPrefs();

    expect(document.body.classList.contains("wp-a11y-no-motion")).toBe(false);

    fixture.mqs[MOTION_QUERY]._trigger(true);
    expect(document.body.classList.contains("wp-a11y-no-motion")).toBe(true);

    teardown();
  });

  it("explicit override wins over system pref", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;

    // Start at auto, then user picks explicit "on" via the settings combo.
    applyA11yClasses(makeApp("auto", "auto"));
    const settings = buildSettings(makeApp());
    const motionSetting = settings.find((s) => s.id === SETTING_MOTION);
    motionSetting?.onChange?.("on", "auto");

    expect(document.body.classList.contains("wp-a11y-no-motion")).toBe(true);

    // System pref is OFF — explicit "on" must persist regardless.
    fixture.mqs[MOTION_QUERY]._trigger(false);
    expect(document.body.classList.contains("wp-a11y-no-motion")).toBe(true);
  });

  it("explicit off wins over system pref", () => {
    const fixture = makeMatchMedia({ motion: true, contrast: true });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;

    applyA11yClasses(makeApp("auto", "auto"));
    const settings = buildSettings(makeApp());
    const contrastSetting = settings.find((s) => s.id === SETTING_CONTRAST);
    contrastSetting?.onChange?.("off", "auto");

    expect(document.body.classList.contains("wp-a11y-high-contrast")).toBe(false);

    // System pref says "high contrast" but explicit off wins.
    fixture.mqs[CONTRAST_QUERY]._trigger(true);
    expect(document.body.classList.contains("wp-a11y-high-contrast")).toBe(false);
  });

  it("teardown — removes both matchMedia listeners (catches HMR leak)", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;

    applyA11yClasses(makeApp());
    const teardown = watchA11ySystemPrefs();

    const motionMQ = fixture.mqs[MOTION_QUERY];
    const contrastMQ = fixture.mqs[CONTRAST_QUERY];
    expect(motionMQ.addEventListener).toHaveBeenCalledTimes(1);
    expect(contrastMQ.addEventListener).toHaveBeenCalledTimes(1);

    teardown();
    expect(motionMQ.removeEventListener).toHaveBeenCalledTimes(1);
    expect(contrastMQ.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it("auto mode + matchMedia undefined — degrades gracefully (no throw)", () => {
    (window as unknown as { matchMedia: undefined }).matchMedia = undefined;

    expect(() => applyA11yClasses(makeApp("auto", "auto"))).not.toThrow();
    expect(document.body.classList.contains("wp-a11y-no-motion")).toBe(false);
    expect(document.body.classList.contains("wp-a11y-high-contrast")).toBe(false);

    expect(() => watchA11ySystemPrefs()()).not.toThrow();
  });

  it("auto mode + matchMedia returns object lacking addEventListener — watcher no-ops", () => {
    window.matchMedia = vi.fn(() => ({ matches: false, media: "" })) as unknown as typeof window.matchMedia;

    applyA11yClasses(makeApp());
    expect(() => watchA11ySystemPrefs()()).not.toThrow();
  });

  it("toast feedback is suppressed during boot window", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;
    applyA11yClasses(makeApp("auto", "auto"));

    // bootCompleted is false (reset in beforeEach). ComfyUI's load-fire
    // onChange would replay the stored value here.
    const settings = buildSettings(makeApp());
    settings.find((s) => s.id === SETTING_MOTION)?.onChange?.("on", "auto");
    settings.find((s) => s.id === SETTING_CONTRAST)?.onChange?.("on", "auto");

    expect(toasts.value).toHaveLength(0);
  });

  it("toast fires after markBootCompleted with descriptive message", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;
    applyA11yClasses(makeApp("auto", "auto"));
    markBootCompleted();

    const settings = buildSettings(makeApp());
    settings.find((s) => s.id === SETTING_MOTION)?.onChange?.("on", "auto");

    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0].message).toBe("Reduce motion: ON");
    expect(toasts.value[0].singletonKey).toBe("a11y-motion");
  });

  it("auto mode toast reports current system pref state", () => {
    const fixture = makeMatchMedia({ motion: true, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;
    applyA11yClasses(makeApp("on", "auto"));
    markBootCompleted();

    const settings = buildSettings(makeApp());
    settings.find((s) => s.id === SETTING_MOTION)?.onChange?.("auto", "on");

    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0].message).toBe("Reduce motion: AUTO (system: reduce)");
  });

  it("rapid toggling replaces toast in place via singletonKey", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;
    applyA11yClasses(makeApp("auto", "auto"));
    markBootCompleted();

    const settings = buildSettings(makeApp());
    const motion = settings.find((s) => s.id === SETTING_MOTION);
    motion?.onChange?.("on", "auto");
    motion?.onChange?.("off", "on");
    motion?.onChange?.("auto", "off");

    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0].message).toContain("AUTO");
    expect(toasts.value[0].singletonKey).toBe("a11y-motion");
  });

  it("no toast when onChange fires with the same value (no-op)", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;
    applyA11yClasses(makeApp("on", "auto"));
    markBootCompleted();

    const settings = buildSettings(makeApp());
    // State is already "on" from applyA11yClasses; onChange("on") is a no-op.
    settings.find((s) => s.id === SETTING_MOTION)?.onChange?.("on", "on");

    expect(toasts.value).toHaveLength(0);
  });

  it("motion and contrast toasts coexist (different singletonKeys)", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;
    applyA11yClasses(makeApp("auto", "auto"));
    markBootCompleted();

    const settings = buildSettings(makeApp());
    settings.find((s) => s.id === SETTING_MOTION)?.onChange?.("on", "auto");
    settings.find((s) => s.id === SETTING_CONTRAST)?.onChange?.("on", "auto");

    expect(toasts.value).toHaveLength(2);
    expect(toasts.value.map((t) => t.singletonKey).sort()).toEqual([
      "a11y-contrast",
      "a11y-motion",
    ]);
  });

  // ── Display preferences — density combo ───────────────────────────

  it("density boot — applies wp-density-comfortable body class by default", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;
    applyDisplayPrefs(makeAppWithDisplay());

    expect(document.body.classList.contains("wp-density-comfortable")).toBe(true);
    expect(document.body.classList.contains("wp-density-compact")).toBe(false);
    expect(document.body.classList.contains("wp-density-minimal")).toBe(false);
  });

  it("density boot — reads stored compact value", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;
    applyDisplayPrefs(makeAppWithDisplay({ density: "compact" }));

    expect(document.body.classList.contains("wp-density-compact")).toBe(true);
    expect(document.body.classList.contains("wp-density-comfortable")).toBe(false);
  });

  it("density onChange — flips body class immediately", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;
    applyDisplayPrefs(makeAppWithDisplay());

    const settings = buildSettings(makeApp());
    settings.find((s) => s.id === SETTING_DENSITY)?.onChange?.("minimal", "comfortable");

    expect(document.body.classList.contains("wp-density-minimal")).toBe(true);
    expect(document.body.classList.contains("wp-density-comfortable")).toBe(false);
  });

  it("density toast — fires after boot with descriptive message", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;
    applyDisplayPrefs(makeAppWithDisplay());
    markBootCompleted();

    const settings = buildSettings(makeApp());
    settings.find((s) => s.id === SETTING_DENSITY)?.onChange?.("compact", "comfortable");

    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0].message).toBe("Density: COMPACT");
    expect(toasts.value[0].singletonKey).toBe("wp-density");
  });

  // ── Display preferences — decoration combo ──────────────────────

  it("decoration boot — applies wp-decor-full by default", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;
    applyDisplayPrefs(makeAppWithDisplay());

    expect(document.body.classList.contains("wp-decor-full")).toBe(true);
  });

  it("decoration boot — reads stored off value", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;
    applyDisplayPrefs(makeAppWithDisplay({ decoration: "off" }));

    expect(document.body.classList.contains("wp-decor-off")).toBe(true);
    expect(document.body.classList.contains("wp-decor-full")).toBe(false);
  });

  it("decoration onChange — flips body class", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;
    applyDisplayPrefs(makeAppWithDisplay());

    const settings = buildSettings(makeApp());
    settings.find((s) => s.id === SETTING_DECORATION)?.onChange?.("minimal", "full");

    expect(document.body.classList.contains("wp-decor-minimal")).toBe(true);
    expect(document.body.classList.contains("wp-decor-full")).toBe(false);
  });

  it("decoration toast — fires with descriptive message", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;
    applyDisplayPrefs(makeAppWithDisplay());
    markBootCompleted();

    const settings = buildSettings(makeApp());
    settings.find((s) => s.id === SETTING_DECORATION)?.onChange?.("off", "full");

    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0].message).toBe("Decoration: OFF");
    expect(toasts.value[0].singletonKey).toBe("wp-decoration");
  });

  // ── Display preferences — indicator style ───────────────────────

  it("indicatorStyle boot — applies wp-indicator-dot by default", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;
    applyDisplayPrefs(makeAppWithDisplay());

    expect(document.body.classList.contains("wp-indicator-dot")).toBe(true);
    expect(document.body.classList.contains("wp-indicator-both")).toBe(false);
  });

  it("indicatorStyle boot — reads stored badge value", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;
    applyDisplayPrefs(makeAppWithDisplay({ indicatorStyle: "badge" }));

    expect(document.body.classList.contains("wp-indicator-badge")).toBe(true);
    expect(document.body.classList.contains("wp-indicator-dot")).toBe(false);
  });

  it("indicatorStyle onChange — flips body class", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;
    applyDisplayPrefs(makeAppWithDisplay());

    const settings = buildSettings(makeApp());
    settings.find((s) => s.id === SETTING_INDICATOR)?.onChange?.("both", "dot");

    expect(document.body.classList.contains("wp-indicator-both")).toBe(true);
    expect(document.body.classList.contains("wp-indicator-dot")).toBe(false);
  });

  it("indicatorStyle toast — fires with descriptive message", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;
    applyDisplayPrefs(makeAppWithDisplay());
    markBootCompleted();

    const settings = buildSettings(makeApp());
    settings.find((s) => s.id === SETTING_INDICATOR)?.onChange?.("badge", "dot");

    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0].message).toBe("Indicators: badge only");
    expect(toasts.value[0].singletonKey).toBe("wp-indicator");
  });

  // ── Display preferences — border highlight ──────────────────────

  it("borderHighlight boot — applies wp-border-highlight-on by default", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;
    applyDisplayPrefs(makeAppWithDisplay());

    expect(document.body.classList.contains("wp-border-highlight-on")).toBe(true);
    expect(document.body.classList.contains("wp-border-highlight-off")).toBe(false);
  });

  it("borderHighlight boot — reads stored false value", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;
    applyDisplayPrefs(makeAppWithDisplay({ borderHighlight: false }));

    expect(document.body.classList.contains("wp-border-highlight-off")).toBe(true);
  });

  it("borderHighlight onChange — flips classes", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;
    applyDisplayPrefs(makeAppWithDisplay());

    const settings = buildSettings(makeApp());
    settings.find((s) => s.id === SETTING_BORDER)?.onChange?.(false, true);

    expect(document.body.classList.contains("wp-border-highlight-off")).toBe(true);
  });

  it("borderHighlight toast — fires with on/off message", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;
    applyDisplayPrefs(makeAppWithDisplay());
    markBootCompleted();

    const settings = buildSettings(makeApp());
    settings.find((s) => s.id === SETTING_BORDER)?.onChange?.(false, true);

    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0].message).toBe("Border highlights: OFF");
    expect(toasts.value[0].singletonKey).toBe("wp-border-highlight");
  });

  // ── Display preferences — collapsed-by-default ──────────────────

  it("collapsedByDefault boot — defaults to false", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;
    applyDisplayPrefs(makeAppWithDisplay());

    expect(getCollapsedByDefault()).toBe(false);
  });

  it("collapsedByDefault boot — reads stored true value", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;
    applyDisplayPrefs(makeAppWithDisplay({ collapsedByDefault: true }));

    expect(getCollapsedByDefault()).toBe(true);
  });

  it("collapsedByDefault onChange — toast fires + state updates", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;
    applyDisplayPrefs(makeAppWithDisplay());
    markBootCompleted();

    const settings = buildSettings(makeApp());
    settings.find((s) => s.id === SETTING_COLLAPSED)?.onChange?.(true, false);

    expect(getCollapsedByDefault()).toBe(true);
    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0].message).toBe("New modules: collapsed by default");
    expect(toasts.value[0].singletonKey).toBe("wp-collapsed-default");
  });

  // ── Display preferences — focus mode ────────────────────────────

  it("focusMode boot — class absent by default", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;
    applyDisplayPrefs(makeAppWithDisplay());

    expect(document.body.classList.contains("wp-focus-mode")).toBe(false);
  });

  it("focusMode boot — class present when stored true", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;
    applyDisplayPrefs(makeAppWithDisplay({ focusMode: true }));

    expect(document.body.classList.contains("wp-focus-mode")).toBe(true);
  });

  it("focusMode onChange — flips class + emits toast", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;
    applyDisplayPrefs(makeAppWithDisplay());
    markBootCompleted();

    const settings = buildSettings(makeApp());
    settings.find((s) => s.id === SETTING_FOCUS)?.onChange?.(true, false);

    expect(document.body.classList.contains("wp-focus-mode")).toBe(true);
    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0].message).toBe("Focus mode: ON");
    expect(toasts.value[0].singletonKey).toBe("wp-focus-mode");
  });

  it("installDebugHelpers exposes window.wpDebug with a11y + display sub-namespaces", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;
    applyA11yClasses(makeApp());
    applyDisplayPrefs(makeAppWithDisplay());

    installDebugHelpers();

    const helpers = (window as unknown as { wpDebug?: {
      a11y: {
        motion: (m: string) => void;
        contrast: (m: string) => void;
        refresh: () => void;
        state: () => { reduceMotion: string; contrast: string };
      };
      display: {
        density: (m: string) => void;
        decoration: (m: string) => void;
        indicatorStyle: (m: string) => void;
        borderHighlight: (on: boolean) => void;
        collapsedByDefault: (on: boolean) => void;
        focusMode: (on: boolean) => void;
        state: () => Record<string, unknown>;
      };
      refresh: () => void;
    } }).wpDebug;

    expect(helpers).toBeDefined();
    expect(typeof helpers?.a11y.motion).toBe("function");
    expect(typeof helpers?.display.density).toBe("function");
    expect(typeof helpers?.display.focusMode).toBe("function");
    expect(typeof helpers?.refresh).toBe("function");

    helpers?.display.density("compact");
    expect(document.body.classList.contains("wp-density-compact")).toBe(true);

    helpers?.display.focusMode(true);
    expect(document.body.classList.contains("wp-focus-mode")).toBe(true);

    helpers?.a11y.motion("on");
    expect(document.body.classList.contains("wp-a11y-no-motion")).toBe(true);
  });

  it("wpDebugA11y stays as deprecation alias for one cycle", () => {
    const fixture = makeMatchMedia({ motion: false, contrast: false });
    window.matchMedia = fixture.factory as unknown as typeof window.matchMedia;
    applyA11yClasses(makeApp());

    installDebugHelpers();

    const legacy = (window as unknown as { wpDebugA11y?: { motion: (m: string) => void } }).wpDebugA11y;
    expect(legacy).toBeDefined();
    expect(typeof legacy?.motion).toBe("function");

    legacy?.motion("on");
    expect(document.body.classList.contains("wp-a11y-no-motion")).toBe(true);
  });
});
