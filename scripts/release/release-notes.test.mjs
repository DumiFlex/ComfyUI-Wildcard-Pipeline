import { describe, expect, it } from "vitest";
import {
  bumpFor,
  nextBetaVersion,
  prependChangelog,
  previousStableTag,
  removeShipped,
  renderBody,
} from "./release-notes.mjs";

describe("renderBody", () => {
  it("puts the curated notes between the header and the compare link", () => {
    const body = renderBody({
      version: "2.21.0",
      currentTag: "v2.21.0",
      previousTag: "v2.20.0",
      highlights: "### Features\n\n- **New.** Thing.\n",
    });
    expect(body.startsWith("## 🎉 Wildcard Pipeline 2.21.0\n\n📖 [Docs (wiki)]")).toBe(true);
    expect(body).toContain("\n\n### Features\n\n- **New.** Thing.\n\n");
    expect(body.endsWith("[v2.20.0…v2.21.0](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/compare/v2.20.0...v2.21.0)\n")).toBe(true);
  });

  it("leaves out the notes when there are none", () => {
    const body = renderBody({ version: "1.0.0", currentTag: "v1.0.0", previousTag: null, highlights: "  \n" });
    expect(body).not.toContain("Full changelog");
    expect(body.endsWith("/issues)\n\n")).toBe(true);
  });
});

describe("previousStableTag", () => {
  const tags = ["v2.9.0", "v2.19.0", "v2.20.0", "v2.21.0-beta.1", "tag-list", "v2.21.0"];
  it("skips betas and non-version tags and compares numerically", () => {
    expect(previousStableTag(tags, "2.21.0")).toBe("v2.20.0");
    expect(previousStableTag(tags, "2.21.0-beta.2")).toBe("v2.20.0");
    expect(previousStableTag(tags, null)).toBe("v2.21.0");
  });
});

describe("bumpFor", () => {
  it("follows the Conventional Commit types", () => {
    expect(bumpFor([{ subject: "docs: words" }, { subject: "chore: x" }])).toBeNull();
    expect(bumpFor([{ subject: "refactor(ai): x" }])).toBe("patch");
    expect(bumpFor([{ subject: "fix: x" }, { subject: "feat(seeds): y" }])).toBe("minor");
    expect(bumpFor([{ subject: "feat!: y" }])).toBe("major");
    expect(bumpFor([{ subject: "fix: y", body: "BREAKING CHANGE: gone" }])).toBe("major");
    expect(bumpFor([{ subject: "Merge pull request #1 from DumiFlex/dev" }])).toBeNull();
  });
});

describe("nextBetaVersion", () => {
  it("numbers betas of the coming version", () => {
    const commits = [{ subject: "feat: new" }];
    expect(nextBetaVersion({ lastStable: "v2.20.0", commits, tags: ["v2.20.0"] })).toBe("2.21.0-beta.1");
    expect(
      nextBetaVersion({ lastStable: "v2.20.0", commits, tags: ["v2.21.0-beta.1", "v2.21.0-beta.2"] }),
    ).toBe("2.21.0-beta.3");
    expect(nextBetaVersion({ lastStable: "v2.20.0", commits: [{ subject: "ci: x" }], tags: [] })).toBeNull();
  });
});

describe("removeShipped", () => {
  const shipped = "Intro.\n\n### Features\n\n- **A.** a.\n- **B.** b.\n\n### Fixes\n\n- **F.** f.\n";

  it("empties the file when nothing was added since", () => {
    expect(removeShipped(shipped, shipped)).toEqual({ text: "", kept: 0 });
  });

  it("keeps new sections added after the release was cut", () => {
    const current = `${shipped}\n### Performance\n\n- **P.** p.\n`;
    expect(removeShipped(current, shipped)).toEqual({ text: "### Performance\n\n- **P.** p.\n", kept: 2 });
  });

  it("keeps a new line under a shipped heading, with the heading", () => {
    const current = shipped.replace("- **B.** b.\n", "- **B.** b.\n- **C.** c.\n");
    expect(removeShipped(current, shipped)).toEqual({ text: "### Features\n\n- **C.** c.\n", kept: 1 });
  });

  it("keeps a reworded shipped line, so a person can decide", () => {
    const current = shipped.replace("- **A.** a.", "- **A.** a, reworded.");
    expect(removeShipped(current, shipped).text).toBe("### Features\n\n- **A.** a, reworded.\n");
  });
});

describe("prependChangelog", () => {
  it("puts the newest release on top", () => {
    expect(prependChangelog("## old\n", "## new\n\n")).toBe("## new\n\n## old\n");
  });
});
