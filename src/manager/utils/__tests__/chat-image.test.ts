import { describe, expect, it } from "vitest";
import { fitSize, ImageReadError, MAX_EDGE, MAX_PIXELS, prepareImage } from "../chat-image";

describe("chat-image", () => {
  it("keeps the shape within the edge and area caps", () => {
    expect(fitSize(800, 600)).toEqual({ w: 800, h: 600 });
    const wide = fitSize(6000, 1000);
    expect(wide.w).toBeLessThanOrEqual(MAX_EDGE);
    expect(wide.w / wide.h).toBeCloseTo(6, 1);
    const big = fitSize(3000, 2000);
    expect(big.w * big.h).toBeLessThanOrEqual(MAX_PIXELS);
    expect(Math.max(big.w, big.h)).toBeLessThanOrEqual(MAX_EDGE);
  });

  it("refuses what isn't an image, or is far too large", async () => {
    await expect(prepareImage(new Blob(["x"], { type: "text/plain" }), "notes.txt"))
      .rejects.toThrow(ImageReadError);
    const huge = { type: "image/png", size: 50 * 1024 * 1024 } as Blob;
    await expect(prepareImage(huge, "huge.png")).rejects.toThrow("too large");
  });
});
