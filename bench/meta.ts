// The bench's tests as the bench page lists them: title, where in the app, the prompt a person
// types, what a good answer looks like and how many attempts each model gets. The data is
// meta.json; the steps that run each test live in tests/.
import data from "./meta.json" with { type: "json" };
import type { ParamValues, RunsSpec, TestMeta } from "watchwright";

export interface BenchModel {
  key: string;
  name: string;
  short: string;
  local: boolean;
  /** Runs only the tests marked for it (Fable). */
  subset?: boolean;
}

export interface BenchTestMeta {
  id: string;
  title: string;
  where?: string;
  prompt?: string;
  steps?: string;
  good?: string;
  measure?: string;
  times?: string[];
  rec: Record<string, number>;
}

export interface BenchSection {
  id: string;
  title: string;
  note?: string;
  tests: BenchTestMeta[];
}

export const MODELS: readonly BenchModel[] = data.models;
export const SECTIONS: readonly BenchSection[] = data.sections as BenchSection[];

const BY_ID = new Map<string, { test: BenchTestMeta; section: BenchSection }>();
for (const section of SECTIONS) for (const test of section.tests) BY_ID.set(test.id, { test, section });

export function benchMeta(id: string): { test: BenchTestMeta; section: BenchSection } {
  const hit = BY_ID.get(id);
  if (!hit) throw new Error(`meta.json has no test ${id}.`);
  return hit;
}

/** The prompt a person types for a test ("" when it has none). */
export function prompt(id: string): string {
  return benchMeta(id).test.prompt ?? "";
}

/** Tests that use an item an earlier test makes and saves. */
export const NEEDS: Record<string, readonly string[]> = {
  W2: ["W1"],
  W22: ["W1"],
  W23: ["W1"],
  W21: ["W20"],
  W24: ["W20"],
  F2: ["F1"],
  F6: ["F1"],
  K2: ["K1"],
  K6: ["K1"],
  R2: ["R1"],
  R4: ["R1"],
  R7: ["R1"],
  X2: ["X1"],
  X7: ["X1"],
  T2: ["T1"],
  T6: ["T1"],
  B5: ["B3"],
  B7: ["B3"],
  // P11 extends the bundle P1 installs.
  P11: ["P1"],
};

/** Attempts per model from the bench page's recommendation; the optional web tests only with `web`. */
export function runsFor(test: BenchTestMeta, section: BenchSection): RunsSpec {
  return (p: ParamValues) => {
    if (section.id === "N" && p.web !== true) return 0;
    return test.rec[String(p.model)] ?? 0;
  };
}

/** What the attempt page shows above the review: where, the steps and what a good answer is. */
export function describeTest(test: BenchTestMeta, section: BenchSection): string {
  const lines: string[] = [];
  if (test.where) lines.push(`Where: ${test.where}`);
  if (test.prompt) lines.push(`Prompt: ${test.prompt}`);
  if (test.steps) lines.push(`Steps: ${test.steps}`);
  if (test.good) lines.push(`Good: ${test.good}`);
  if (test.measure) lines.push(`Measure: ${test.measure}`);
  if (section.note) lines.push(`Section: ${section.note}`);
  return lines.join("\n\n");
}

/** The test metadata Watchwright reads, from meta.json plus what the steps add. */
export function testMeta(id: string, extra: Partial<TestMeta> = {}): TestMeta {
  const { test, section } = benchMeta(id);
  const needs = [...(NEEDS[id] ?? []), ...(extra.needs ?? [])];
  return {
    title: test.title,
    section: section.title,
    description: describeTest(test, section),
    runs: runsFor(test, section),
    ...extra,
    ...(needs.length > 0 ? { needs } : {}),
    tags: [section.id.toLowerCase(), ...(extra.tags ?? [])],
  };
}
