import { mount, flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const wildcardFiles = vi.fn();
vi.mock("../../api/client", () => ({
  api: { importExport: { wildcardFiles: (form: FormData) => wildcardFiles(form) } },
}));

import ImportTab from "../ImportTab.vue";
import PackConverter from "../PackConverter.vue";
import {
  buildWildcardForm,
  describeNote,
  filterPlan,
  isWildcardFileName,
  looksLikeWpExport,
  sourcesFromFileList,
  suggestPackName,
  suggestPackTag,
  summarizePlan,
  type PlanItem,
  type WildcardFilesResult,
} from "../wildcard-files";

function item(over: Partial<PlanItem>): PlanItem {
  return {
    id: "abcd1234", name: "animals/cats", domain: "animals", role: "vocabulary",
    options: 1, refs: 0, referenced_by: 1, fidelity: "exact", notes: [], source: "animals/cats.txt",
    ...over,
  };
}

function result(): WildcardFilesResult {
  return {
    payload: {
      schema_version: 2,
      bundles: [],
      wildcards: [{
        id: "abcd1234", type: "wildcard", name: "animals/cats", description: "",
        category_id: null, tags: [], is_favorite: false,
        payload: { var_binding: "cats", sub_categories: [], options: [{ id: "o1", value: "tabby", weight: 1, sub_categories: [] }] },
      }],
      fixed_values: [], combines: [], derivations: [], constraints: [], categories: [], templates: [],
    },
    report: {
      files: [
        { path: "animals/cats.txt", status: "ok", wildcards: 1 },
        { path: "old/cats.txt", status: "ok", wildcards: 0, duplicates: 1 },
      ],
      notes: [
        { kind: "duplicate_value", count: 2, examples: [{ wildcard: "animals/cats", detail: "tabby" }] },
        { kind: "condition_dropped", count: 1, examples: [{ wildcard: "animals/cats", detail: "if _is_sdxl" }] },
      ],
      wildcards: 1, groups: 0, options: 1, bundles: 0,
      plan: [
        item({ fidelity: "lossy", notes: [{ kind: "condition_dropped", detail: "if _is_sdxl" }] }),
        item({ id: "11111111", name: "scenes/intro", domain: "scenes", role: "entry", refs: 2, referenced_by: 0 }),
      ],
    },
  };
}

function file(name: string, text = "x\n"): File {
  return new File([text], name);
}

describe("wildcard-files helpers", () => {
  it("recognises wildcard file names", () => {
    expect(isWildcardFileName("a/b.TXT")).toBe(true);
    expect(isWildcardFileName("pack.zip")).toBe(true);
    expect(isWildcardFileName("readme.md")).toBe(false);
  });

  it("tells our exports apart from Dynamic Prompts JSON files", () => {
    expect(looksLikeWpExport(JSON.stringify({ schema_version: 2, wildcards: [] }))).toBe(true);
    expect(looksLikeWpExport(JSON.stringify({ clothing: ["a", "b"] }))).toBe(false);
    expect(looksLikeWpExport(JSON.stringify(["a", "b"]))).toBe(false);
    expect(looksLikeWpExport("not json")).toBe(false);
  });

  it("keeps folder paths from a folder picker and drops other files", () => {
    const a = file("cats.txt");
    Object.defineProperty(a, "webkitRelativePath", { value: "My Pack/animals/cats.txt" });
    const sources = sourcesFromFileList([a, file("notes.md")]);
    expect(sources.map((s) => s.path)).toEqual(["My Pack/animals/cats.txt"]);
    expect(suggestPackName(sources)).toBe("My Pack");
    expect(suggestPackTag(sources)).toBe("my-pack");
    expect(suggestPackName([{ path: "Billions.zip", file: file("Billions.zip") }])).toBe("Billions");
    expect(suggestPackName([{ path: "a.txt", file: file("a.txt") }])).toBe("");
  });

  it("builds the multipart form with paths and options", async () => {
    const form = buildWildcardForm(
      [{ path: "x/a.txt", file: file("a.txt") }],
      { packTag: " pack ", exclude: ["x/b.txt"], bundles: false, packName: "Pack" },
    );
    const meta = JSON.parse(String(form.get("meta")));
    expect(meta).toEqual({
      paths: ["x/a.txt"], pack_tag: "pack", exclude: ["x/b.txt"], bundles: false, pack_name: "Pack",
      merge: true, keep_separate: [],
    });
    const off = JSON.parse(String(buildWildcardForm([], { merge: false, keepSeparate: ["hair"] }).get("meta")));
    expect(off).toMatchObject({ merge: false, keep_separate: ["hair"] });
    expect(form.getAll("file")).toHaveLength(1);
  });

  it("describes every note kind in plain words", () => {
    expect(describeNote("condition_dropped")).toMatch(/if-conditions/);
    expect(describeNote("something_new")).toBe("something new");
  });
});

describe("plan helpers", () => {
  const plan = [
    item({ name: "b/list" , domain: "b" }),
    item({ name: "a/intro", domain: "a", role: "entry" }),
    item({ name: "a/list", domain: "a", fidelity: "lossy" }),
    item({ name: "loose", domain: "" }),
  ];

  it("counts roles, fidelity and domains, loose files last", () => {
    const s = summarizePlan(plan);
    expect(s.roles).toEqual({ entry: 1, composition: 0, vocabulary: 3, group: 0 });
    expect(s.fidelity).toEqual({ exact: 3, close: 0, lossy: 1 });
    expect(s.domains.map((d) => [d.name, d.count, d.entries, d.lossy])).toEqual([
      ["a", 2, 1, 1], ["b", 1, 0, 0], ["", 1, 0, 0],
    ]);
  });

  it("filters by domain, role, fidelity and name, entry points first", () => {
    const all = { domain: null, roles: new Set<never>(), fidelities: new Set<never>(), query: "" };
    expect(filterPlan(plan, all).map((p) => p.name)).toEqual(["a/intro", "a/list", "b/list", "loose"]);
    expect(filterPlan(plan, { ...all, domain: "a" })).toHaveLength(2);
    expect(filterPlan(plan, { ...all, roles: new Set(["entry"] as const) }).map((p) => p.name)).toEqual(["a/intro"]);
    expect(filterPlan(plan, { ...all, fidelities: new Set(["lossy"] as const) }).map((p) => p.name)).toEqual(["a/list"]);
    expect(filterPlan(plan, { ...all, query: "LOOSE" })).toHaveLength(1);
  });

  it("finds a merged wildcard by the name of a list inside it", () => {
    const merged = item({
      name: "hair/colors", merge_root: "hair/colors",
      merged_from: [{ name: "warm/red", tag: "red", options: 2 }],
    });
    const all = { domain: null, roles: new Set<never>(), fidelities: new Set<never>(), query: "warm/r" };
    expect(filterPlan([...plan, merged], all).map((p) => p.name)).toEqual(["hair/colors"]);
  });
});

describe("ImportTab hands wildcard packs off", () => {
  beforeEach(() => {
    wildcardFiles.mockReset();
  });

  it("emits dropped wildcard files instead of converting them", async () => {
    const wrap = mount(ImportTab, { props: { payloadLoaded: false } });
    await wrap.find("[data-test='import-dropzone']").trigger("drop", {
      dataTransfer: { files: [file("cats.txt"), file("dogs.yaml")] },
    });
    await flushPromises();
    expect(wildcardFiles).not.toHaveBeenCalled();
    const sources = wrap.emitted("wildcard-files")?.[0]?.[0] as Array<{ path: string }>;
    expect(sources.map((s) => s.path)).toEqual(["cats.txt", "dogs.yaml"]);
  });

  it("treats a dropped Dynamic Prompts JSON file as a pack, not an export", async () => {
    const wrap = mount(ImportTab);
    await wrap.find("[data-test='import-dropzone']").trigger("drop", {
      dataTransfer: { files: [file("colors.json", JSON.stringify({ colors: ["red"] }))] },
    });
    await flushPromises();
    expect(wrap.emitted("wildcard-files")).toHaveLength(1);
    expect(wrap.emitted("payload-ready")).toBeFalsy();
  });

  it("links to the Wildcard packs tab", async () => {
    const wrap = mount(ImportTab);
    await wrap.find("[data-test='import-open-packs']").trigger("click");
    expect(wrap.emitted("wildcard-files")?.[0]?.[0]).toEqual([]);
  });
});

describe("PackConverter", () => {
  beforeEach(() => {
    wildcardFiles.mockReset();
    wildcardFiles.mockResolvedValue(result());
  });

  async function loaded() {
    const wrap = mount(PackConverter, {
      props: { incoming: [{ path: "My Pack/animals/cats.txt", file: file("cats.txt") }] },
    });
    await flushPromises();
    return wrap;
  }

  it("starts on the drop zone", () => {
    const wrap = mount(PackConverter);
    expect(wrap.find("[data-test='pack-dropzone']").exists()).toBe(true);
    expect(wrap.find("[aria-current='step']").text()).toContain("Load pack");
  });

  it("converts a pack handed over and shows the plan", async () => {
    const wrap = await loaded();
    expect(wildcardFiles).toHaveBeenCalledTimes(1);
    const meta = JSON.parse(String((wildcardFiles.mock.calls[0][0] as FormData).get("meta")));
    expect(meta).toMatchObject({ pack_name: "My Pack", pack_tag: "my-pack", bundles: true });
    expect(wrap.find("[aria-current='step']").text()).toContain("Review plan");
    const rows = wrap.findAll("[data-test='pack-row']");
    // Entry points lead.
    expect(rows.map((r) => r.find(".wp-pack__name").text())).toEqual(["scenes/intro", "animals/cats"]);
    expect(wrap.find("[data-test='pack-stat-entry']").text()).toContain("1");
  });

  it("filters by role and domain, and expands a row's notes", async () => {
    const wrap = await loaded();
    await wrap.find("[data-test='pack-stat-entry']").trigger("click");
    expect(wrap.findAll("[data-test='pack-row']")).toHaveLength(1);
    await wrap.find("[data-test='pack-stat-entry']").trigger("click");
    const animals = wrap.findAll("[data-test='pack-domains'] button").find((b) => b.text().startsWith("animals"));
    await animals?.trigger("click");
    const rows = wrap.findAll("[data-test='pack-row']");
    expect(rows).toHaveLength(1);
    await rows[0].trigger("click");
    expect(wrap.text()).toContain("if _is_sdxl");
  });

  it("re-runs the conversion when settings change, then continues", async () => {
    const wrap = await loaded();
    const apply = wrap.find("[data-test='pack-apply']");
    expect(apply.attributes("disabled")).toBeDefined();
    await wrap.find("[data-test='pack-files-toggle']").trigger("click");
    const boxes = wrap.findAll("[data-test='pack-files'] input[type='checkbox']");
    await boxes[1].setValue(false);
    expect(wrap.find("[data-test='pack-continue']").attributes("disabled")).toBeDefined();
    await apply.trigger("click");
    await flushPromises();
    expect(wildcardFiles).toHaveBeenCalledTimes(2);
    const meta = JSON.parse(String((wildcardFiles.mock.calls[1][0] as FormData).get("meta")));
    expect(meta.exclude).toEqual(["old/cats.txt"]);
    await wrap.find("[data-test='pack-continue']").trigger("click");
    expect(wrap.emitted("payload-ready")).toHaveLength(1);
  });

  it("shows merged wildcards and splits one back into lists", async () => {
    const merged = result();
    merged.report.merged = 1;
    merged.report.merged_lists = 2;
    merged.report.plan.push(item({
      id: "22222222", name: "hair/colors", domain: "hair", options: 4,
      merge_root: "hair/colors",
      merged_from: [
        { name: "warm/red", tag: "warm and red", options: 2 },
        { name: "dark", tag: "dark", options: 2 },
      ],
      tag_groups: [{ name: "colors", tags: 2 }, { name: "colors (2)", tags: 1 }],
    }));
    wildcardFiles.mockResolvedValue(merged);
    const wrap = await loaded();
    expect(wrap.find("[data-test='pack-summary']").text()).toContain("2 lists were merged into 1 tagged wildcard");
    expect(wrap.find("[data-test='pack-merged-chip']").text()).toBe("2 lists");
    await wrap.find("[data-test='pack-merged-only']").trigger("click");
    const rows = wrap.findAll("[data-test='pack-row']");
    expect(rows).toHaveLength(1);
    await rows[0].trigger("click");
    const detail = wrap.find("[data-test='pack-merge-detail']");
    expect(detail.text()).toContain("colors (2)");
    expect(detail.findAll(".wp-pack__member-tag").map((t) => t.text())).toEqual(["warm + red", "dark"]);
    await wrap.find("[data-test='pack-keep-separate']").trigger("click");
    await flushPromises();
    expect(wildcardFiles).toHaveBeenCalledTimes(2);
    const meta = JSON.parse(String((wildcardFiles.mock.calls[1][0] as FormData).get("meta")));
    expect(meta).toMatchObject({ merge: true, keep_separate: ["hair/colors"] });
    expect(wrap.find("[data-test='pack-kept']").text()).toContain("hair/colors/");
    await wrap.find("[data-test='pack-kept'] button").trigger("click");
    await flushPromises();
    const again = JSON.parse(String((wildcardFiles.mock.calls[2][0] as FormData).get("meta")));
    expect(again.keep_separate).toEqual([]);
  });

  it("folds into a bar once the picker shows, with a way back", async () => {
    const wrap = await loaded();
    await wrap.setProps({ payloadLoaded: true });
    expect(wrap.find("[data-test='pack-loaded']").text()).toContain("My Pack");
    await wrap.find("[data-test='pack-back']").trigger("click");
    expect(wrap.emitted("back")).toHaveLength(1);
  });

  it("shows the server's error", async () => {
    wildcardFiles.mockRejectedValueOnce(new Error("pack.zip: File is not a zip file"));
    const wrap = await loaded();
    expect(wrap.find("[data-test='pack-error']").text()).toBe("pack.zip: File is not a zip file");
  });
});
