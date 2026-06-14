import { describe, expect, it } from "vitest";
import {
  STARTER_BUNDLE_NAME,
  STARTER_MODULE_DESCRIPTORS,
  STARTER_MODULE_SLOTS,
  STARTER_TEMPLATE_NAME,
  buildAccentPayload,
  buildMoodPayload,
  buildPairingPayload,
  buildScenePayload,
  buildStylePayload,
  buildSubjectPayload,
  buildTemplateInput,
} from "../starter-recipe";
import type {
  CombinePayload,
  ConstraintPayload,
  DerivationPayload,
  WildcardPayload,
} from "../../api/types";

const HEX8 = /^[0-9a-f]{8}$/;

describe("starter-recipe — slot table", () => {
  it("lists the six module slots in dependency order (constraint last)", () => {
    expect([...STARTER_MODULE_SLOTS]).toEqual([
      "subject", "mood", "style", "scene", "accent", "pairing",
    ]);
  });

  it("descriptor kinds match the recipe", () => {
    expect(STARTER_MODULE_DESCRIPTORS.subject.kind).toBe("wildcard");
    expect(STARTER_MODULE_DESCRIPTORS.mood.kind).toBe("wildcard");
    expect(STARTER_MODULE_DESCRIPTORS.style.kind).toBe("fixed_values");
    expect(STARTER_MODULE_DESCRIPTORS.scene.kind).toBe("combine");
    expect(STARTER_MODULE_DESCRIPTORS.accent.kind).toBe("derivation");
    expect(STARTER_MODULE_DESCRIPTORS.pairing.kind).toBe("constraint");
  });

  it("only the pairing descriptor needs context", () => {
    expect(STARTER_MODULE_DESCRIPTORS.pairing.needsContext).toBe(true);
    for (const slot of ["subject", "mood", "style", "scene", "accent"] as const) {
      expect(STARTER_MODULE_DESCRIPTORS[slot].needsContext).toBe(false);
    }
  });

  it("exposes the bundle + template name constants", () => {
    expect(STARTER_BUNDLE_NAME).toBe("Starter set");
    expect(STARTER_TEMPLATE_NAME).toBe("Starter prompt");
  });
});

describe("starter-recipe — wildcard payloads", () => {
  it("subject: var_binding, sub_categories, four options keyed to subcats", () => {
    const p: WildcardPayload = buildSubjectPayload();
    expect(p.var_binding).toBe("subject");
    expect(p.sub_categories).toEqual(["feline", "canine"]);
    expect(p.options.map((o) => o.value)).toEqual(["cat", "tiger", "dog", "wolf"]);
    expect(p.options.map((o) => o.sub_categories)).toEqual([
      ["feline"], ["feline"], ["canine"], ["canine"],
    ]);
    expect(p.options.every((o) => o.weight === 1)).toBe(true);
    // Each option carries a fresh 8-hex id.
    expect(p.options.every((o) => HEX8.test(o.id))).toBe(true);
  });

  it("mood: var_binding + calm/intense options", () => {
    const p = buildMoodPayload();
    expect(p.var_binding).toBe("mood");
    expect(p.sub_categories).toEqual(["calm", "intense"]);
    expect(p.options.map((o) => o.value)).toEqual(["serene", "sleepy", "fierce", "dramatic"]);
    expect(p.options.map((o) => o.sub_categories)).toEqual([["calm"], ["calm"], ["intense"], ["intense"]]);
  });

  it("mints fresh, unique option ids on each build", () => {
    const a = buildSubjectPayload();
    const b = buildSubjectPayload();
    const idsA = a.options.map((o) => o.id);
    const idsB = b.options.map((o) => o.id);
    // Unique within a build.
    expect(new Set(idsA).size).toBe(idsA.length);
    // Disjoint across builds (no baked-in constant ids).
    expect(idsA.some((id) => idsB.includes(id))).toBe(false);
  });
});

describe("starter-recipe — style / scene / accent payloads", () => {
  it("style: single named value, no $ prefix, fresh id", () => {
    const p = buildStylePayload();
    expect(p.values).toHaveLength(1);
    expect(p.values[0].name).toBe("style");
    expect(p.values[0].name.startsWith("$")).toBe(false);
    expect(p.values[0].value).toBe("oil painting");
    expect(HEX8.test(p.values[0].id)).toBe(true);
    // Fresh id per build.
    expect(buildStylePayload().values[0].id).not.toBe(p.values[0].id);
  });

  it("scene: combine template + vars", () => {
    const p: CombinePayload = buildScenePayload();
    expect(p.template).toBe("$mood $subject");
    expect(p.output_var).toBe("scene");
    expect(p.input_vars).toEqual(["mood", "subject"]);
  });

  it("accent: one rule with dramatic branch + soft-lighting else", () => {
    const p: DerivationPayload = buildAccentPayload();
    expect(p.rules).toHaveLength(1);
    const rule = p.rules[0];
    expect(HEX8.test(rule.id)).toBe(true);
    expect(rule.branches).toHaveLength(1);
    expect(rule.branches[0].condition).toEqual({ var: "mood", op: "equals", value: "dramatic" });
    expect(rule.branches[0].action).toEqual({
      target_var: "accent", mode: "replace", value: "cinematic lighting",
    });
    expect(rule.else?.action).toEqual({
      target_var: "accent", mode: "replace", value: "soft lighting",
    });
    // Fresh rule id per build.
    expect(buildAccentPayload().rules[0].id).not.toBe(rule.id);
  });
});

describe("starter-recipe — constraint payload", () => {
  it("wires both wildcard ids", () => {
    const p: ConstraintPayload = buildPairingPayload({ subjectId: "aaaa1111", moodId: "bbbb2222" });
    expect(p.source_wildcard_id).toBe("aaaa1111");
    expect(p.target_wildcard_id).toBe("bbbb2222");
    expect(p.exceptions).toEqual([]);
  });

  it("stamps source/target wildcard names when the ctx carries them", () => {
    const p = buildPairingPayload({
      subjectId: "aaaa1111",
      moodId: "bbbb2222",
      subjectName: "Starter subject",
      moodName: "Starter mood",
    });
    // Self-describing axis names so a never-opened starter constraint renders
    // the wildcard name on the community instead of a raw uuid.
    expect(p.source_wildcard_name).toBe("Starter subject");
    expect(p.target_wildcard_name).toBe("Starter mood");
  });

  it("omits the name fields when the ctx has no names (legacy callers stay clean)", () => {
    const p = buildPairingPayload({ subjectId: "aaaa1111", moodId: "bbbb2222" });
    expect(p).not.toHaveProperty("source_wildcard_name");
    expect(p).not.toHaveProperty("target_wildcard_name");
  });

  it("matrix keys equal subject sub_categories; inner keys equal mood sub_categories", () => {
    const subject = buildSubjectPayload();
    const mood = buildMoodPayload();
    const p = buildPairingPayload({ subjectId: "s", moodId: "m" });
    // Outer keys == source (subject) sub_categories.
    expect(Object.keys(p.matrix).sort()).toEqual([...subject.sub_categories].sort());
    // Inner keys (per source subcat) == target (mood) sub_categories.
    for (const srcSub of Object.keys(p.matrix)) {
      expect(Object.keys(p.matrix[srcSub]).sort()).toEqual([...mood.sub_categories].sort());
    }
  });

  it("matrix cells use valid modes + factors", () => {
    const p = buildPairingPayload({ subjectId: "s", moodId: "m" });
    expect(p.matrix.feline.intense).toEqual({ mode: "boost", factor: 3 });
    expect(p.matrix.feline.calm).toEqual({ mode: "reduce", factor: 0.3 });
    expect(p.matrix.canine.calm).toEqual({ mode: "boost", factor: 3 });
    expect(p.matrix.canine.intense).toEqual({ mode: "reduce", factor: 0.3 });
  });
});

describe("starter-recipe — template input", () => {
  it("builds the standalone template create body", () => {
    const t = buildTemplateInput();
    expect(t.name).toBe("Starter prompt");
    expect(t.template_string).toBe("$scene, $style, $accent, masterpiece, highly detailed");
  });
});

describe("starter-recipe — descriptor buildPayload wiring", () => {
  it("simple descriptors produce the same shape as their builders", () => {
    const desc = STARTER_MODULE_DESCRIPTORS.subject;
    expect(desc.needsContext).toBe(false);
    if (!desc.needsContext) {
      const subj = desc.buildPayload();
      expect(subj.var_binding).toBe("subject");
      expect(subj.options).toHaveLength(4);
    }
  });

  it("pairing descriptor forwards the context ids", () => {
    const desc = STARTER_MODULE_DESCRIPTORS.pairing;
    expect(desc.needsContext).toBe(true);
    if (desc.needsContext) {
      const payload = desc.buildPayload({ subjectId: "x1", moodId: "y2" });
      expect(payload.source_wildcard_id).toBe("x1");
      expect(payload.target_wildcard_id).toBe("y2");
    }
  });
});
