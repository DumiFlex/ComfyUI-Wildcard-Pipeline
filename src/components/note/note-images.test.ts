import { describe, expect, it } from "vitest";
import { capProblem, dataUrlBytes, fitSide, MAX_IMAGES, newImageId, prunePictures } from "./note-images";

const pic = (bytes: number) => ({ src: `data:image/webp;base64,${"A".repeat(Math.ceil(bytes * 4 / 3))}`, w: 10, h: 10 });

describe("note pictures", () => {
  it("fits the long side without upscaling", () => {
    expect(fitSide(2560, 1440)).toEqual({ w: 1280, h: 720 });
    expect(fitSide(720, 2560)).toEqual({ w: 360, h: 1280 });
    expect(fitSide(300, 200)).toEqual({ w: 300, h: 200 });
  });

  it("makes ids that are new to the note", () => {
    const seq = [0x1a2b3c4d / 0x100000000, 0x0000beef / 0x100000000];
    const id = newImageId({ "1a2b3c4d": 1 }, () => seq.shift() ?? 0);
    expect(id).toBe("0000beef");
  });

  it("caps the count and the total size", () => {
    const six = Object.fromEntries(Array.from({ length: MAX_IMAGES }, (_, i) => [`0000000${i}`, pic(10)]));
    expect(capProblem(six, 10)).toMatch(/at most 6/);
    expect(capProblem({ a1b2c3d4: pic(1.9 * 1024 * 1024) }, 200 * 1024)).toMatch(/2 MB/);
    expect(capProblem({}, 100)).toBeNull();
    expect(dataUrlBytes(pic(300).src)).toBe(300);
  });

  it("keeps only the pictures the text names", () => {
    const images = { "1a2b3c4d": pic(1), "00000001": pic(1) };
    expect(Object.keys(prunePictures("x ![a](wp:image/1a2b3c4d) ![b](wp:asset/toolbar-help)", images))).toEqual(["1a2b3c4d"]);
  });
});
