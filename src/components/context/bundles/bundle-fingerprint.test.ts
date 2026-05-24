import { describe, it, expect } from "vitest";
import type { BundleInstance, ModuleEntry } from "../../../widgets/_shared";
import {
  computeBundleFingerprint,
  bundleSnapshotModified,
} from "./bundle-fingerprint";

function mod(
  uid: string,
  hash: string,
  bundle_origin?: string,
): ModuleEntry & { _uid: string; bundle_origin?: string } {
  return {
    _uid: uid,
    id: `id-${uid}`,
    type: "wildcard",
    enabled: true,
    collapsed: false,
    meta: { name: uid },
    entries: [],
    payload: {},
    instance: {},
    payload_hash: hash,
    ...(bundle_origin !== undefined ? { bundle_origin } : {}),
  } as ModuleEntry & { _uid: string; bundle_origin?: string };
}

function bundle(
  start: number,
  end: number,
  snapshot_fingerprint?: string,
): BundleInstance {
  return {
    _uid: "B",
    library_id: "L",
    start_idx: start,
    end_idx: end,
    enabled: true,
    collapsed: false,
    inserted_at_hash: "h",
    name: "B",
    color: null,
    ...(snapshot_fingerprint !== undefined ? { snapshot_fingerprint } : {}),
  };
}

describe("computeBundleFingerprint", () => {
  it("empty bundle (end<start) returns sentinel '0'", () => {
    const b = bundle(2, 1);
    expect(computeBundleFingerprint(b, [])).toBe("v2:0");
  });

  it("deterministic — same input → same fingerprint", () => {
    const mods = [mod("u1", "h1", "B"), mod("u2", "h2", "B")];
    const b = bundle(0, 1);
    expect(computeBundleFingerprint(b, mods)).toBe(
      computeBundleFingerprint(b, mods),
    );
  });

  it("different children → different fingerprint", () => {
    const a = bundle(0, 1);
    const fpA = computeBundleFingerprint(a, [mod("u1", "h1", "B"), mod("u2", "h2", "B")]);
    const fpB = computeBundleFingerprint(a, [mod("u1", "h1", "B"), mod("u3", "h3", "B")]);
    expect(fpA).not.toBe(fpB);
  });

  it("uid change flips fingerprint (catches add/remove)", () => {
    const b = bundle(0, 0);
    const fpA = computeBundleFingerprint(b, [mod("u1", "h1")]);
    const fpB = computeBundleFingerprint(b, [mod("u2", "h1")]);
    expect(fpA).not.toBe(fpB);
  });

  it("bundle_origin change flips fingerprint (catches drag-out)", () => {
    const b = bundle(0, 0);
    const fpA = computeBundleFingerprint(b, [mod("u1", "h1", "B")]);
    const fpB = computeBundleFingerprint(b, [mod("u1", "h1", "INNER")]);
    expect(fpA).not.toBe(fpB);
  });

  it("payload_hash change flips fingerprint (catches edit/refresh)", () => {
    const b = bundle(0, 0);
    const fpA = computeBundleFingerprint(b, [mod("u1", "h-old")]);
    const fpB = computeBundleFingerprint(b, [mod("u1", "h-new")]);
    expect(fpA).not.toBe(fpB);
  });

  it("order matters — same children swapped → different fingerprint", () => {
    const b = bundle(0, 1);
    const fpAB = computeBundleFingerprint(b, [
      mod("u1", "h1", "B"),
      mod("u2", "h2", "B"),
    ]);
    const fpBA = computeBundleFingerprint(b, [
      mod("u2", "h2", "B"),
      mod("u1", "h1", "B"),
    ]);
    expect(fpAB).not.toBe(fpBA);
  });

  it("only walks the bundle's [start..end] range, ignores siblings", () => {
    const b = bundle(1, 2); // range [1..2]
    const mods = [
      mod("outside-pre", "h0"),
      mod("u1", "h1", "B"),
      mod("u2", "h2", "B"),
      mod("outside-post", "h3"),
    ];
    const fpFull = computeBundleFingerprint(b, mods);
    // Same range with sibling rows changed → fingerprint unchanged.
    const fpDifferentSiblings = computeBundleFingerprint(b, [
      mod("outside-pre-CHANGED", "hXX"),
      mod("u1", "h1", "B"),
      mod("u2", "h2", "B"),
      mod("outside-post-CHANGED", "hYY"),
    ]);
    expect(fpFull).toBe(fpDifferentSiblings);
  });

  it("missing module at an index is skipped (defensive, doesn't crash)", () => {
    const b = bundle(0, 1);
    // Range claims 2 modules but only 1 exists.
    const fp = computeBundleFingerprint(b, [mod("u1", "h1", "B")]);
    expect(fp).toMatch(/^v2:[0-9a-f]{8}$/);
  });

  it("inner-bundle leaves carry their inner uid in origin — outer fingerprint sees the chain", () => {
    // Bundle B outer at [0..2]: 1 direct leaf, 2 leaves inside inner.
    const outer = bundle(0, 2);
    const mods = [
      mod("u1", "h1", "B"),         // outer leaf
      mod("u2", "h2", "INNER-A"),   // inner-A leaf
      mod("u3", "h3", "INNER-A"),   // inner-A leaf
    ];
    const fpOriginal = computeBundleFingerprint(outer, mods);
    // Swap inner-A for a different inner uid (user replaced the inner).
    const fpSwapped = computeBundleFingerprint(outer, [
      mod("u1", "h1", "B"),
      mod("u2", "h2", "INNER-B"),
      mod("u3", "h3", "INNER-B"),
    ]);
    expect(fpOriginal).not.toBe(fpSwapped);
  });

  it("fingerprint is 8 hex characters", () => {
    const b = bundle(0, 0);
    const fp = computeBundleFingerprint(b, [mod("u1", "h1")]);
    expect(fp).toMatch(/^v2:[0-9a-f]{8}$/);
  });
});

describe("bundleSnapshotModified", () => {
  it("returns FALSE when no fingerprint stored (backfill / clean baseline)", () => {
    const b = bundle(0, 0); // no snapshot_fingerprint
    expect(bundleSnapshotModified(b, [mod("u1", "h1")])).toBe(false);
  });

  it("returns FALSE when current state matches stored fingerprint", () => {
    const mods = [mod("u1", "h1", "B")];
    const fp = computeBundleFingerprint(bundle(0, 0), mods);
    const b = bundle(0, 0, fp);
    expect(bundleSnapshotModified(b, mods)).toBe(false);
  });

  it("returns TRUE when leaf payload_hash changes (edit / refresh)", () => {
    const original = [mod("u1", "h1", "B")];
    const fp = computeBundleFingerprint(bundle(0, 0), original);
    const b = bundle(0, 0, fp);
    const edited = [mod("u1", "h2", "B")];
    expect(bundleSnapshotModified(b, edited)).toBe(true);
  });

  it("returns TRUE when a leaf is added (range grew)", () => {
    const original = [mod("u1", "h1", "B")];
    const fp = computeBundleFingerprint(bundle(0, 0), original);
    // Bundle range grew to [0..1] after adding a leaf.
    const b = bundle(0, 1, fp);
    const after = [mod("u1", "h1", "B"), mod("u2", "h2", "B")];
    expect(bundleSnapshotModified(b, after)).toBe(true);
  });

  it("returns TRUE when a leaf is removed (range shrunk)", () => {
    const original = [mod("u1", "h1", "B"), mod("u2", "h2", "B")];
    const fp = computeBundleFingerprint(bundle(0, 1), original);
    const b = bundle(0, 0, fp); // range shrunk
    expect(bundleSnapshotModified(b, [mod("u1", "h1", "B")])).toBe(true);
  });

  it("returns TRUE when a leaf is dragged out (bundle_origin cleared)", () => {
    const original = [mod("u1", "h1", "B")];
    const fp = computeBundleFingerprint(bundle(0, 0), original);
    const b = bundle(0, 0, fp);
    // Same leaf, no bundle_origin (dragged to top-level).
    const after = [mod("u1", "h1")];
    expect(bundleSnapshotModified(b, after)).toBe(true);
  });
});
