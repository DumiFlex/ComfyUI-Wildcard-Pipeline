/**
 * TS mirror of engine/seed_derive.py — lets the seed modal preview the
 * per-iteration seed list without running the graph. Parity is guarded
 * by tests/fixtures/seed-derive-corpus.json. Values masked to 50 bits.
 */
export type SeedStrategy = "sequential" | "hash_index" | "prime_stride";

const MASK = (1n << 50n) - 1n;

export function deriveLoopSeeds(base: number, count: number, strategy: SeedStrategy): number[] {
  if (count <= 1) return [Number(BigInt(base) & MASK)];
  if (strategy === "sequential") {
    return Array.from({ length: count }, (_, i) => Number((BigInt(base) + BigInt(i)) & MASK));
  }
  if (strategy === "prime_stride") {
    return Array.from({ length: count }, (_, i) => Number((BigInt(base) + BigInt(i) * 1000003n) & MASK));
  }
  if (strategy === "hash_index") {
    return Array.from({ length: count }, (_, i) => {
      const digest = sha256Bytes(`${base}:${i}`);
      let v = 0n;
      for (let b = 0; b < 8; b++) v = (v << 8n) | BigInt(digest[b]);
      return Number(v & MASK);
    });
  }
  throw new Error(`unknown loop seed strategy: ${strategy}`);
}

export function applySeedLocks(derived: number[], locks: Record<number, number>): number[] {
  return derived.map((s, i) =>
    Object.prototype.hasOwnProperty.call(locks, i) ? Number(BigInt(locks[i]) & MASK) : s,
  );
}

/**
 * TS mirror of engine/seed_derive.py `effective_chain_seed` — the seed a
 * WP_Context node rolls at iteration `loopIndex`. An override (the loop's
 * already-per-iteration derived seed) is used verbatim; only a constant
 * widget seed (no override) gets the loop_index XOR. Mirrors the engine's
 * no-double-shift rule so a per-frame seed lock pins the seed the module
 * actually rolls at that frame.
 */
export function effectiveChainSeed(
  widgetSeed: number, seedOverride: number | null, loopIndex: number,
): number {
  const base = seedOverride != null ? BigInt(seedOverride) : BigInt(widgetSeed);
  if (loopIndex === 0 || seedOverride != null) return Number(base & MASK);
  const digest = sha256Bytes(`loop:${loopIndex}`);
  let shift = 0n;
  for (let b = 0; b < 8; b++) shift = (shift << 8n) | BigInt(digest[b]);
  return Number((base ^ shift) & MASK);
}

const LOCK_LINE = /^\s*#(\d+)\s*:\s*(-?\d+)\s*$/;

/**
 * Parse the `#N: seed` lines produced by the seed modal's Copy (1-based
 * display index) back into a 0-based seed_locks map. Non-matching lines are
 * ignored; values are masked to 50 bits like the engine (negatives normalize
 * deterministically). UI-only — no Python mirror, so no parity corpus.
 */
export function parseSeedLocks(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(LOCK_LINE);
    if (!m) continue;
    const display = Number(m[1]);
    if (display < 1) continue; // #N is 1-based; #0 / #-1 are invalid
    out[String(display - 1)] = Number(BigInt(m[2]) & MASK);
  }
  return out;
}

function sha256Bytes(msg: string): Uint8Array {
  const K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
  const bytes = new TextEncoder().encode(msg);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array((Math.ceil((bytes.length + 1 + 8) / 64)) * 64);
  padded.set(bytes); padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, bitLen >>> 0);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i-15],7) ^ rotr(w[i-15],18) ^ (w[i-15] >>> 3);
      const s1 = rotr(w[i-2],17) ^ rotr(w[i-2],19) ^ (w[i-2] >>> 10);
      w[i] = (w[i-16] + s0 + w[i-7] + s1) | 0;
    }
    let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,hh=h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh=g; g=f; f=e; e=(d + t1)|0; d=c; c=b; b=a; a=(t1 + t2)|0;
    }
    h0=(h0+a)|0; h1=(h1+b)|0; h2=(h2+c)|0; h3=(h3+d)|0; h4=(h4+e)|0; h5=(h5+f)|0; h6=(h6+g)|0; h7=(h7+hh)|0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  [h0,h1,h2,h3,h4,h5,h6,h7].forEach((hv, i) => odv.setUint32(i*4, hv >>> 0));
  return out;
}
