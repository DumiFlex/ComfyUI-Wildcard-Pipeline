/**
 * Generates `tests/fixtures/encode_key_js_outputs.json` with byte-exact
 * outputs for a fixed set of inputs. Python's cross-language fitness
 * test reads the fixture and asserts `encode_key()` matches every byte.
 *
 * Run via: `npx tsx src/components/context/editors/instance/keys.fitness.ts`
 *
 * Inputs cover:
 *   - ASCII (red/blue), unicode (é/中)
 *   - Embedded JSON metacharacters (",\)
 *   - Empty strings
 *   - Embedded delim-look-alikes (a,b / c:d)
 *   - Surrogate-pair unicode (𝄞 = U+1D11E, encoded as surrogate pair)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeKey } from "./keys";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cases: ReadonlyArray<{ input: readonly string[] }> = [
  { input: ["red", "blue"] },
  { input: ["é", "中"] },
  { input: ['"q"', "back\\slash"] },
  { input: ["", ""] },
  { input: ["a,b", "c:d"] },
  { input: ["𝄞", "music"] },
];

const outputs = cases.map((c) => ({ input: c.input, output: encodeKey(c.input) }));
const fixturePath = path.resolve(__dirname, "../../../../../tests/fixtures/encode_key_js_outputs.json");
fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
fs.writeFileSync(fixturePath, JSON.stringify(outputs, null, 2) + "\n");
// eslint-disable-next-line no-console
console.log(`Wrote ${outputs.length} cases to ${fixturePath}`);
