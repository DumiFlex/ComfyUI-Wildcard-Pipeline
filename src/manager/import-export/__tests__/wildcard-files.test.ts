import { mount, flushPromises } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const wildcardFiles = vi.fn();
vi.mock("../../api/client", () => ({
  api: { importExport: { wildcardFiles: (form: FormData) => wildcardFiles(form) } },
}));

import ImportTab from "../ImportTab.vue";
import WildcardFilesPanel from "../WildcardFilesPanel.vue";
import {
  buildWildcardForm,
  describeNote,
  isWildcardFileName,
  looksLikeWpExport,
  sourcesFromFileList,
  suggestPackName,
  suggestPackTag,
  type WildcardFilesResult,
} from "../wildcard-files";

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
    });
    expect(form.getAll("file")).toHaveLength(1);
  });

  it("describes every note kind in plain words", () => {
    expect(describeNote("condition_dropped")).toMatch(/if-conditions/);
    expect(describeNote("something_new")).toBe("something new");
  });
});

describe("ImportTab wildcard files", () => {
  beforeEach(() => {
    wildcardFiles.mockReset();
    wildcardFiles.mockResolvedValue(result());
  });

  it("converts dropped wildcard files and shows the report", async () => {
    const wrap = mount(ImportTab, { props: { payloadLoaded: false } });
    await wrap.find("[data-test='import-dropzone']").trigger("drop", {
      dataTransfer: { files: [file("cats.txt"), file("dogs.yaml")] },
    });
    await flushPromises();
    expect(wildcardFiles).toHaveBeenCalledTimes(1);
    const meta = JSON.parse(String((wildcardFiles.mock.calls[0][0] as FormData).get("meta")));
    expect(meta.paths).toEqual(["cats.txt", "dogs.yaml"]);
    expect(meta.bundles).toBe(true);
    const emitted = wrap.emitted("payload-ready");
    expect(emitted).toBeTruthy();
    await wrap.setProps({ payloadLoaded: true });
    expect(wrap.text()).toContain("From wildcard files");
    expect(wrap.find("[data-test='wildcard-files-panel']").exists()).toBe(true);
  });

  it("treats a dropped Dynamic Prompts JSON file as wildcards, not an export", async () => {
    const wrap = mount(ImportTab);
    await wrap.find("[data-test='import-dropzone']").trigger("drop", {
      dataTransfer: { files: [file("colors.json", JSON.stringify({ colors: ["red"] }))] },
    });
    await flushPromises();
    expect(wildcardFiles).toHaveBeenCalledTimes(1);
  });

  it("shows the server's error without the payload prefix", async () => {
    wildcardFiles.mockRejectedValueOnce(new Error("pack.zip: File is not a zip file"));
    const wrap = mount(ImportTab);
    await wrap.find("[data-test='import-dropzone']").trigger("drop", {
      dataTransfer: { files: [file("pack.zip")] },
    });
    await flushPromises();
    const err = wrap.find("[data-test='import-tab-error']");
    expect(err.text()).toBe("pack.zip: File is not a zip file");
  });

  it("re-runs the conversion with a file left out", async () => {
    const wrap = mount(ImportTab, { props: { payloadLoaded: false } });
    await wrap.find("[data-test='import-dropzone']").trigger("drop", {
      dataTransfer: { files: [file("cats.txt")] },
    });
    await flushPromises();
    await wrap.setProps({ payloadLoaded: true });
    const panel = wrap.findComponent(WildcardFilesPanel);
    const boxes = panel.findAll("input[type='checkbox']");
    // [bundles toggle, files...]; the second file is the duplicate copy.
    await boxes[boxes.length - 1].setValue(false);
    await panel.find("[data-test='wildcard-files-apply']").trigger("click");
    await flushPromises();
    expect(wildcardFiles).toHaveBeenCalledTimes(2);
    const meta = JSON.parse(String((wildcardFiles.mock.calls[1][0] as FormData).get("meta")));
    expect(meta.exclude).toEqual(["old/cats.txt"]);
  });
});

describe("WildcardFilesPanel", () => {
  it("lists notes that need attention first and expands examples", async () => {
    const wrap = mount(WildcardFilesPanel, {
      props: { report: result().report, options: { bundles: true } },
    });
    const rows = wrap.findAll(".wp-wcf__note-row");
    expect(rows[0].text()).toContain("if-conditions");
    await rows[0].trigger("click");
    expect(wrap.text()).toContain("if _is_sdxl");
    expect(wrap.text()).toContain("already defined by another file");
  });

  it("keeps Apply disabled until something changes", async () => {
    const wrap = mount(WildcardFilesPanel, {
      props: { report: result().report, options: { packTag: "a", bundles: true } },
    });
    const apply = wrap.find("[data-test='wildcard-files-apply']");
    expect(apply.attributes("disabled")).toBeDefined();
    await wrap.find("[data-test='wildcard-files-tag']").setValue("b");
    expect(apply.attributes("disabled")).toBeUndefined();
    await apply.trigger("click");
    expect(wrap.emitted("apply")?.[0]?.[0]).toMatchObject({ packTag: "b", bundles: true });
  });
});
