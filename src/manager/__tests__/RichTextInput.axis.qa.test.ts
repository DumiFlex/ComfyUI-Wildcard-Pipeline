/**
 * QA sweep over `$var.AXIS` authoring in the template editor.
 *
 * Written from a real session against the SPA combine editor, where typing an
 * axis reference misbehaved in several separate ways at once. Each `it` here is
 * one reported (or adjacent, suspected) interaction, so a regression names the
 * behaviour that broke rather than "the editor".
 */
import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import RichTextInput from "../components/RichTextInput.vue";

const PRODUCERS = new Map([
  ["outfit", {
    kind: "wildcard", shadowed: 0, moduleName: "QA outfit",
    axes: [
      { axis: "SHOES", tags: ["sneakers", "high_heels", "sandals"], hueIndex: 1 },
      { axis: "EXPOSES", tags: ["navel"], hueIndex: 2 },
    ],
  }],
  ["shoes", { kind: "wildcard", shadowed: 0, moduleName: "QA shoes" }],
]);

function mountEditor(modelValue = "") {
  return mount(RichTextInput, {
    props: {
      modelValue,
      varSuggestions: ["outfit", "shoes"],
      varProducers: PRODUCERS,
      multiline: true,
    },
    attachTo: document.body,
  });
}

/** Type `text` into the host's trailing text span and fire `input`, which is
 *  how a browser delivers a keystroke to a contenteditable. */
async function typeInto(wrap: ReturnType<typeof mountEditor>, text: string) {
  const host = wrap.find(".wp-rt__host");
  const spans = (host.element as HTMLElement).querySelectorAll(".wp-rt__text");
  const target = spans[spans.length - 1] ?? host.element;
  target.textContent = (target.textContent ?? "") + text;
  await host.trigger("input");
  await nextTick();
  return host;
}

/** Open the `$` popover the way the component exposes for tests. It sets the
 *  trigger without a query, so every suggestion is listed — which is what we
 *  want when asserting that the axis rows EXIST and are shaped correctly.
 *  Query-narrowing is covered at the probe level, where it is deterministic. */
async function openVarPopover(wrap: ReturnType<typeof mountEditor>) {
  await (wrap.vm as unknown as {
    __triggerAutocompleteForTest: (t: "@" | "$") => Promise<void>;
  }).__triggerAutocompleteForTest("$");
  await flushPromises();
}

describe("axis authoring — the popover", () => {
  it("lists each variable's axes as their own rows", async () => {
    const wrap = mountEditor();
    await openVarPopover(wrap);
    const labels = [...document.querySelectorAll(".wp-rt-suggestions__label")]
      .map((n) => n.textContent ?? "");
    expect(labels.some((l) => l.includes("outfit"))).toBe(true);
    expect(labels.some((l) => l.includes("outfit.SHOES"))).toBe(true);
    expect(labels.some((l) => l.includes("outfit.EXPOSES"))).toBe(true);
    wrap.unmount();
  });

  it("REPORTED: the axis row is indented under its variable", async () => {
    // A later `padding` SHORTHAND on the base rule was resetting the
    // modifier's padding-left, so the hierarchy these rows exist to show
    // rendered flat.
    const wrap = mountEditor();
    await openVarPopover(wrap);
    const axisRow = [...document.querySelectorAll(".wp-rt-suggestions__item")]
      .find((n) => (n.textContent ?? "").includes("outfit.SHOES")) as HTMLElement | undefined;
    expect(axisRow).toBeDefined();
    expect(axisRow!.className).toContain("wp-rt-suggestions__item--axis");
    wrap.unmount();
  });

  it("shows the member tags, which are what tell two axes apart", async () => {
    const wrap = mountEditor();
    await openVarPopover(wrap);
    const axisRow = [...document.querySelectorAll(".wp-rt-suggestions__item")]
      .find((n) => (n.textContent ?? "").includes("outfit.SHOES"));
    expect(axisRow?.textContent).toContain("sneakers");
    wrap.unmount();
  });

  it("a variable with no axes contributes exactly one row", async () => {
    const wrap = mountEditor();
    await openVarPopover(wrap);
    const shoesRows = [...document.querySelectorAll(".wp-rt-suggestions__label")]
      .filter((n) => (n.textContent ?? "").includes("shoes"));
    expect(shoesRows).toHaveLength(1);
    wrap.unmount();
  });
});

describe("axis authoring — the chip", () => {
  it("REPORTED: $outfit.SHOES renders as ONE var atom, not inert text", async () => {
    const wrap = mountEditor("wearing $outfit.SHOES today");
    await nextTick();
    const host = wrap.find(".wp-rt__host").element as HTMLElement;
    const vars = host.querySelectorAll(".wp-refchip--var, .wp-rt-var");
    expect(vars.length).toBeGreaterThan(0);
    expect(host.textContent).toContain("$outfit.SHOES");
    wrap.unmount();
  });

  it("keeps the whole reference in one atom so it deletes as a unit", async () => {
    const wrap = mountEditor("$outfit.SHOES");
    await nextTick();
    const host = wrap.find(".wp-rt__host").element as HTMLElement;
    // Two atoms would mean backspace eats `.SHOES` and leaves a bare `$outfit`
    // that silently means something else.
    const atoms = host.querySelectorAll(".wp-refchip--var, .wp-rt-var");
    expect(atoms.length).toBe(1);
    wrap.unmount();
  });

  it("round-trips the value unchanged", async () => {
    const wrap = mountEditor("a $outfit.SHOES b");
    await nextTick();
    await wrap.find(".wp-rt__host").trigger("input");
    const events = wrap.emitted("update:modelValue") ?? [];
    if (events.length) {
      expect(events[events.length - 1]?.[0]).toBe("a $outfit.SHOES b");
    }
    wrap.unmount();
  });
});

describe("axis authoring — editing an existing reference", () => {
  it("REPORTED: backspace deletes a character without committing a chip", async () => {
    const wrap = mountEditor();
    await typeInto(wrap, "$outfi");
    await flushPromises();
    const host = wrap.find(".wp-rt__host");
    // The component handles Backspace itself and preventDefaults, so the test
    // must NOT also remove the character — doing both deletes twice and
    // "reproduces" a bug that is purely the harness.
    await host.trigger("keydown", { key: "Backspace" });
    await flushPromises();
    // Mid-word text must stay editable text: Backspace must never be the thing
    // that seals a chip, or a typo costs the whole reference.
    const chips = (host.element as HTMLElement).querySelectorAll(".wp-refchip");
    expect(chips.length).toBe(0);
    wrap.unmount();
  });

  it("an undeclared axis is marked rather than silently empty", async () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "$outfit.BELTS",
        varSuggestions: ["outfit", "shoes"],
        varProducers: PRODUCERS,
        graphAware: true,
      },
      attachTo: document.body,
    });
    await nextTick();
    const html = (wrap.find(".wp-rt__host").element as HTMLElement).innerHTML;
    // The engine renders an undeclared axis as "", so the only symptom without
    // a mark is a word missing from the prompt.
    expect(html).toContain("wp-refchip__accessor--unknown");
    wrap.unmount();
  });

  it("a declared axis is NOT marked as an error", async () => {
    const wrap = mount(RichTextInput, {
      props: {
        modelValue: "$outfit.SHOES",
        varSuggestions: ["outfit", "shoes"],
        varProducers: PRODUCERS,
        graphAware: true,
      },
      attachTo: document.body,
    });
    await nextTick();
    const html = (wrap.find(".wp-rt__host").element as HTMLElement).innerHTML;
    expect(html).not.toContain("wp-refchip__accessor--unknown");
    wrap.unmount();
  });
});

describe("echo guard — the cause behind the Backspace bug", () => {
  it("a parent that echoes modelValue back must not re-parse it into chips", async () => {
    // Found in a real browser, invisible to jsdom: the atom-direct edit paths
    // sync the host DOM imperatively AFTER updating the model, so the watcher's
    // `readHostAsText() === next` guard still saw the PRE-edit string, missed,
    // and re-parsed through parseForSurface — which chipifies. One Backspace
    // mid-word therefore sealed `$mo` into a chip, closed the popover and threw
    // the caret onto the host root: three reported symptoms, one echo.
    const wrap = mountEditor("start");
    await nextTick();
    // Emit, then echo the emitted value back exactly as a controlled parent does.
    const host = wrap.find(".wp-rt__host");
    const span = (host.element as HTMLElement).querySelector(".wp-rt__text");
    if (span) span.textContent = "start $mo";
    await host.trigger("input");
    await flushPromises();
    const ev = wrap.emitted("update:modelValue") ?? [];
    const emitted = ev[ev.length - 1]?.[0] as string;
    await wrap.setProps({ modelValue: emitted });
    await flushPromises();
    // Mid-word text stays text; the echo must be a no-op.
    expect((host.element as HTMLElement).querySelectorAll(".wp-refchip").length).toBe(0);
    wrap.unmount();
  });
});
