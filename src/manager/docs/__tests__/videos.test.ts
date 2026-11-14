import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { findPage } from "../registry";
import {
  NODE_VIDEOS, PAGE_VIDEOS, TUTORIAL_VIDEOS, VIDEO_SECTIONS,
  findVideo, pageVideos, playlistUrl, videoUrl, videosIn,
} from "../videos";

describe("tutorial videos", () => {
  it("has one video per tutorial test", () => {
    const tests = readdirSync(resolve(__dirname, "../../../../tutorials/tests"))
      .filter((f) => f.endsWith(".ts"))
      .map((f) => {
        const m = /^([a-z]+)?(\d+b?)-/i.exec(f);
        const code = m ? `${(m[1] ?? "t").toUpperCase()}${m[2] ?? ""}` : f;
        return code.replace(/B$/, "b");
      });
    expect(new Set(TUTORIAL_VIDEOS.map((v) => v.code))).toEqual(new Set(tests));
  });

  it("gives every video a unique id and a section with a playlist", () => {
    expect(new Set(TUTORIAL_VIDEOS.map((v) => v.id)).size).toBe(TUTORIAL_VIDEOS.length);
    for (const s of VIDEO_SECTIONS) {
      expect(videosIn(s.id).length, s.id).toBeGreaterThan(0);
      expect(playlistUrl(s)).toMatch(/^https:\/\/www\.youtube\.com\/playlist\?list=PL[\w-]+$/);
    }
    for (const v of TUTORIAL_VIDEOS) expect(videoUrl(v)).toMatch(/^https:\/\/youtu\.be\/[\w-]{11}$/);
  });

  it("points every page entry at a real page and video", () => {
    for (const [page, codes] of Object.entries(PAGE_VIDEOS)) {
      expect(findPage(page), page).toBeTruthy();
      for (const c of codes) expect(findVideo(c), `${page}: ${c}`).toBeTruthy();
    }
    for (const c of Object.values(NODE_VIDEOS)) expect(findVideo(c), c).toBeTruthy();
  });

  it("gives every node page its own video first", () => {
    for (const [node, code] of Object.entries(NODE_VIDEOS)) {
      const page = findPageByNode(node);
      expect(page, node).toBeTruthy();
      expect(pageVideos(page)[0]?.code, node).toBe(code);
    }
  });

  it("shows nothing for a page without videos", () => {
    expect(pageVideos("glossary")).toEqual([]);
    expect(pageVideos(undefined)).toEqual([]);
  });
});

function findPageByNode(node: string): string | undefined {
  return Object.keys(PAGE_VIDEOS).find((id) => findPage(id)?.nodeId === node);
}
