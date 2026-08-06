import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every setting in ComfyUI's panel must also appear in the Display Playground.
 *
 * The playground is where users expect to see the settings mirrored, and
 * keeping the two in step has been a manual chore — `playground-store.ts` even
 * carries a comment asking the next person to "keep this routing in sync if a
 * new key is added". A comment is not a mechanism: the tag-autocomplete setting
 * was added to the panel under the wrong category, in a namespace matching none
 * of the three the playground routes, and with no playground row at all. It
 * took a screenshot to notice.
 *
 * This is that mechanism. It reads the two sources and fails when they drift.
 */
const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const settingsSrc = read("../../../extension/settings.ts");
const playgroundSrc = read("../DisplayPlaygroundModal.vue");
const storeSrc = read("../playground-store.ts");

/**
 * Setting ids registered into ComfyUI's panel.
 *
 * Matches the id STRINGS anywhere in the file rather than `id:` sites, because
 * most entries reference a `SETTING_ID_*` constant declared further up. An
 * earlier version of this regex looked only at `id:` and found exactly one
 * setting — which the "finds them at all" assertion below caught immediately,
 * and is why that assertion exists.
 */
function registeredIds(): string[] {
  return [...new Set(
    [...settingsSrc.matchAll(/"(wildcardPipeline\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+)"/g)]
      .map((m) => m[1]),
  )]
    // Leading underscore marks a launcher/action row rather than a value —
    // the playground's own "Open playground" button is one, and mirroring it
    // inside the playground would be circular.
    .filter((id) => !id.split(".").pop()!.startsWith("_"));
}

/** Namespaces the playground store knows how to route a key into. */
const ROUTED_NAMESPACES = ["display", "a11y", "behavior"];

describe("playground mirrors the settings panel", () => {
  const ids = registeredIds();

  it("finds the registered settings at all (guards the regex itself)", () => {
    expect(ids.length).toBeGreaterThan(5);
  });

  it.each(ids)("%s uses a namespace the playground can route", (id) => {
    const namespace = id.split(".")[1];
    expect(ROUTED_NAMESPACES).toContain(namespace);
  });

  it.each(ids)("%s has a key the playground store recognises", (id) => {
    const key = id.split(".").pop()!;
    // Either listed in a routing set, or reachable as the default `display`
    // namespace — both mean `settingId()` can resolve it.
    expect(storeSrc).toContain(`"${key}"`);
  });

  it.each(ids)("%s is bound to a control in the playground", (id) => {
    const key = id.split(".").pop()!;
    // The modal reads with getSettingValue and writes with applySetting; a
    // setting present in the panel but absent here is the drift we are after.
    expect(playgroundSrc).toContain(`applySetting("${key}"`);
  });
});
