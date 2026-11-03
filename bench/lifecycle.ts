// Putting the person's library back around runs, shared by the bench, smoke and library packs.
// Setup saves the library and the AI settings the person had, teardown puts them back, and the
// tasks do it by hand (Watchwright's pack tasks, from the pack page's Tasks tab). Everything goes
// through the app's own backups: a live restore (POST /wp/api/database/backups/restore) swaps the
// library in place, with no restart. See README.md › Putting your library back.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { StepError, type Helpers, type PackState, type RunRef, type TaskDefinition } from "watchwright";
import { resetLibrary } from "./shared.js";

/** One entry of GET /wp/api/database/backups. */
export interface BackupEntry {
  name: string;
  reason: string;
  created_at?: string;
  size?: number;
  pinned?: boolean;
  note?: string | null;
}

/** The pack state keys, in one place (the pack page's Tasks tab lists them under Saved values). */
const K = {
  /** The person's library from before the run (a pinned backup). */
  original: "original",
  /** Whose library is live: "run" (the run's) or "original" (the person's). */
  holds: "holds",
  /** The run's library, kept while the person's is back (a pinned backup). */
  runData: "runData",
  /** The bench library as a pinned backup, and the hash of the fixture it was made from. */
  baseline: "baseline",
  baselineHash: "baselineHash",
  /** The person's unpinned backups the run pinned so its own backups can't prune them. */
  protected: "protected",
  /** The AI settings from before the run. */
  aiBefore: "aiBefore",
  /** Every backup this pack made, so Clean up can remove them. */
  made: "made",
} as const;

/** The AI settings a pack changes; only these are put back. */
const AI_KEYS = ["allow_delete", "auto_apply", "tool_format"] as const;

export const NOTE = "Watchwright";

// ---- the app's backups --------------------------------------------------------------------------

export async function listBackups(h: Helpers): Promise<BackupEntry[]> {
  const r = await h.api("/wp/api/database/backups");
  if (r.status >= 400) throw new StepError(`Couldn't list the backups (${r.status}): ${r.text.slice(0, 200)}`);
  return ((r.json?.backups as BackupEntry[] | undefined) ?? []).slice();
}

function remember(state: PackState, name: string): void {
  const made = state.get<string[]>(K.made) ?? [];
  if (!made.includes(name)) state.set(K.made, [...made, name]);
}

/** Backs the library up with a note (max 80 characters); returns the backup's name. */
export async function backup(h: Helpers, state: PackState, note: string, { pin = false } = {}): Promise<string> {
  const r = await h.api("/wp/api/database/backups", { method: "POST", body: { note: note.slice(0, 80) } });
  const name = r.json?.name as string | undefined;
  if (r.status >= 300 || !name) throw new StepError(`The backup failed (${r.status}): ${r.text.slice(0, 200)}`);
  remember(state, name);
  const pruned = (r.json?.pruned as string[] | undefined) ?? [];
  if (pruned.length) h.log(`Backing up removed ${pruned.length} older backup(s): ${pruned.join(", ")}.`);
  if (pin) await setPinned(h, name, true);
  return name;
}

export async function setPinned(h: Helpers, name: string, pinned: boolean): Promise<boolean> {
  const r = await h.api(`/wp/api/database/backups/${encodeURIComponent(name)}/pin`, { method: "PUT", body: { pinned } });
  if (r.status === 404) return false;
  if (r.status >= 400) throw new StepError(`Couldn't ${pinned ? "pin" : "unpin"} ${name} (${r.status}): ${r.text.slice(0, 200)}`);
  return true;
}

export async function deleteBackup(h: Helpers, name: string): Promise<void> {
  const r = await h.api(`/wp/api/database/backups/${encodeURIComponent(name)}`, { method: "DELETE" });
  if (r.status >= 400 && r.status !== 404) h.log(`Couldn't delete backup ${name} (${r.status}).`);
}

/**
 * Restores a backup into the live library (no restart) and reloads the manager so it shows it.
 * Returns the "Before restore" backup the app took of the library it replaced. A busy library
 * (409 "busy") is tried again for up to half a minute.
 */
export async function restore(h: Helpers, state: PackState, name: string): Promise<string> {
  for (let i = 0; ; i++) {
    const r = await h.api("/wp/api/database/backups/restore", { method: "POST", body: { name } });
    const pre = r.json?.pre_restore as string | undefined;
    if (r.status < 300 && pre) {
      remember(state, pre);
      h.log(`Restored ${name} (the library it replaced is backup ${pre}).`);
      await h.visit("wildcards");
      return pre;
    }
    if (r.status === 409 && /busy/i.test(r.text) && i < 6) {
      await h.wait(5000);
      continue;
    }
    if (r.status === 404) throw new StepError(`Backup ${name} is gone, so it can't be restored (deleted by hand, or the folder moved).`);
    throw new StepError(`Restoring ${name} was refused (${r.status}): ${r.text.slice(0, 300)}. An older build needs a ComfyUI restart to restore; update the extension.`);
  }
}

/** The extension's version, from the X-WP-Version header every API answer carries. */
export async function appVersion(h: Helpers): Promise<string | null> {
  await h.api("/wp/api/database/backups");
  return h.page
    .evaluate(async () => (await fetch("/wp/api/database/backups")).headers.get("X-WP-Version"))
    .catch(() => null);
}

// ---- AI settings ---------------------------------------------------------------------------------

async function saveAi(h: Helpers, state: PackState): Promise<void> {
  const cfg = await h.aiConfig();
  state.set(K.aiBefore, Object.fromEntries(AI_KEYS.filter((k) => k in cfg).map((k) => [k, cfg[k]])));
}

export async function putAiBack(h: Helpers, state: PackState): Promise<void> {
  const before = state.get<Record<string, unknown>>(K.aiBefore);
  if (!before || !Object.keys(before).length) return;
  await h.setAiConfig(before);
  h.log(`Put the AI settings back: ${Object.entries(before).map(([k, v]) => `${k} ${String(v)}`).join(", ")}.`);
}

// ---- whose library is live -----------------------------------------------------------------------

/** Pins the person's unpinned backups, so the run's own backups can't prune them. */
async function protect(h: Helpers, state: PackState): Promise<void> {
  const mine = (await listBackups(h)).filter((b) => !b.pinned);
  const done = state.get<string[]>(K.protected) ?? [];
  for (const b of mine) if (await setPinned(h, b.name, true)) done.push(b.name);
  state.set(K.protected, [...new Set(done)]);
  if (mine.length) h.log(`Pinned your ${mine.length} unpinned backup(s) for the run, so its backups don't push them out; teardown unpins them.`);
}

async function unprotect(h: Helpers, state: PackState): Promise<void> {
  const list = state.get<string[]>(K.protected) ?? [];
  for (const name of list) await setPinned(h, name, false);
  state.delete(K.protected);
  if (list.length) h.log(`Unpinned the ${list.length} backup(s) the run had pinned.`);
}

/** The bench library live: the pinned baseline when it matches the fixture, else an import. */
export async function loadBenchLibrary(h: Helpers, state: PackState, fixture: string): Promise<void> {
  const hash = createHash("sha256").update(readFileSync(fixture)).digest("hex").slice(0, 16);
  const baseline = state.get<string>(K.baseline);
  const have = baseline && state.get<string>(K.baselineHash) === hash && (await listBackups(h)).some((b) => b.name === baseline);
  if (have && baseline) {
    await restore(h, state, baseline);
    h.log("Loaded the bench library from its pinned backup.");
    return;
  }
  if (baseline) {
    await setPinned(h, baseline, false);
    await deleteBackup(h, baseline);
  }
  await resetLibrary(h, fixture, { backupFirst: false });
  state.set(K.baseline, await backup(h, state, `${NOTE}: bench library`, { pin: true }));
  state.set(K.baselineHash, hash);
}

/**
 * The person's library back. With `keepRun`, the run's library is kept as a pinned backup first,
 * so a run that goes on later gets it back. Does nothing when the person's library is live.
 */
export async function giveOriginal(h: Helpers, state: PackState, keepRun: boolean, label: string): Promise<string | null> {
  const original = state.get<string>(K.original);
  if (state.get(K.holds) !== "run" || !original) {
    h.log("Your own library is already there.");
    return null;
  }
  const pre = await restore(h, state, original);
  state.set(K.holds, "original");
  if (keepRun) {
    await setPinned(h, pre, true);
    state.set(K.runData, pre);
    h.log(`Kept the run's library as backup ${pre} (${label}), for when it goes on.`);
  }
  return pre;
}

/**
 * The run's library back, when a task gave the person's back meanwhile. The person's library as it
 * is now (with anything they changed during the pause) becomes the one teardown puts back.
 */
export async function giveBack(h: Helpers, state: PackState): Promise<void> {
  const runData = state.get<string>(K.runData);
  if (state.get(K.holds) !== "original" || !runData) return;
  const pre = await restore(h, state, runData);
  const old = state.get<string>(K.original);
  await setPinned(h, pre, true);
  state.set(K.original, pre);
  if (old && old !== pre) await setPinned(h, old, false);
  // The run's library is live again, so its paused copy isn't needed.
  await setPinned(h, runData, false);
  await deleteBackup(h, runData);
  state.delete(K.runData);
  state.set(K.holds, "run");
  h.log(`Gave the run its library back; your library as it was is backup ${pre}.`);
}

// ---- the hooks -----------------------------------------------------------------------------------

export interface LifecycleOptions {
  /** The bench library to load on a new run, when `reset` is on, from the pack's folder. */
  fixture: (packDir: string) => string;
  /** Refuse `reset` unless this says yes (the smoke pack only resets on the fake server). */
  canReset?: (h: Helpers) => Promise<boolean>;
}

/** Setup's part: run it after the pack's own checks. */
export async function lifecycleSetup(
  ctx: { h: Helpers; state: PackState; start: "new" | "resume" | "redo"; run: RunRef; packDir: string; params: Record<string, unknown>; info(k: string, v: string | number | boolean): void },
  opts: LifecycleOptions,
): Promise<void> {
  const { h, state, start, run, params } = ctx;
  const version = await appVersion(h);
  if (version) ctx.info("Extension", version);
  if (start !== "new") {
    await giveBack(h, state);
    ctx.info("Library", state.get(K.holds) === "run" ? "the run's (resumed)" : "yours");
    return;
  }
  // A new run: an earlier run that never ended (the server died) may still hold the library.
  if (state.get(K.holds) === "run" && state.get(K.original))
    h.log(`An earlier run never put your library back; backup ${String(state.get(K.original))} still has it (pinned). This run saves the library as it is now.`);
  state.delete(K.runData);
  // Forget backups that are gone (deleted after passing attempts, pruned), so the list stays small.
  const there = new Set((await listBackups(h)).map((b) => b.name));
  state.set(K.made, (state.get<string[]>(K.made) ?? []).filter((n) => there.has(n)));
  await saveAi(h, state);
  if (params.putBack !== false) {
    await protect(h, state);
    state.set(K.original, await backup(h, state, `${NOTE}: your library before run ${run.id}`, { pin: true }));
    state.set(K.holds, "run");
  } else state.delete(K.holds);
  if (params.reset === true) {
    if (opts.canReset && !(await opts.canReset(h))) throw new StepError("reset would empty a real library here. Turn reset off, or start the fake server.");
    await loadBenchLibrary(h, state, opts.fixture(ctx.packDir));
  }
  ctx.info("Library", params.reset === true ? "bench library" : "as it was");
  ctx.info("Put back after", params.putBack !== false ? "yes" : "no");
}

/** Teardown: AI settings back, then the person's library back (keeping the run's when it was stopped). */
export async function lifecycleTeardown(ctx: { h: Helpers; state: PackState; status: "finished" | "stopped" | "failed"; params: Record<string, unknown> }): Promise<void> {
  const { h, state, status, params } = ctx;
  await putAiBack(h, state);
  if (params.putBack === false || !state.get(K.original)) return;
  const runEnd = await giveOriginal(h, state, status === "stopped", "the run was stopped");
  if (status === "stopped") return; // a resume brings the run's library back and makes more backups
  // The run's library at its end isn't needed once the run is over.
  if (runEnd) await deleteBackup(h, runEnd);
  const original = state.get<string>(K.original);
  if (original) await setPinned(h, original, false);
  await unprotect(h, state);
}

/** What a paused run does when it goes on after a task: its library back. */
export const lifecycleAfterTask = ({ h, state }: { h: Helpers; state: PackState }) => giveBack(h, state);

// ---- the tasks -----------------------------------------------------------------------------------

async function report(h: Helpers, state: PackState): Promise<string> {
  const lib = await h.library();
  const byType = new Map<string, number>();
  for (const m of lib.modules) byType.set(m.type ?? "?", (byType.get(m.type ?? "?") ?? 0) + 1);
  const backups = await listBackups(h);
  const made = new Set(state.get<string[]>(K.made) ?? []);
  const cfg = await h.aiConfig();
  const lines = [
    `# Library report`,
    ``,
    `- Modules: ${lib.modules.length} (${[...byType].map(([t, n]) => `${n} ${t}`).join(", ")})`,
    `- Bundles: ${lib.bundles.length}, templates: ${lib.templates.length}`,
    `- Live library: ${state.get(K.holds) === "run" ? "a run's" : "yours"}`,
    `- Backups: ${backups.length}, pinned ${backups.filter((b) => b.pinned).length}, made by this pack ${backups.filter((b) => made.has(b.name)).length}`,
    `- AI: ${String(cfg.provider ?? "?")} · ${String(cfg.model ?? "?")}, deleting ${cfg.allow_delete ? "on" : "off"}, auto-apply ${cfg.auto_apply ? "on" : "off"}, tool format ${String(cfg.tool_format ?? "auto")}`,
    ``,
    `| Backup | Note | Pinned | This pack's |`,
    `|---|---|---|---|`,
    ...backups.slice(0, 30).map((b) => `| ${b.name} | ${b.note ?? b.reason} | ${b.pinned ? "yes" : ""} | ${made.has(b.name) ? "yes" : ""} |`),
  ];
  return lines.join("\n");
}

/** The tasks every pack of the bench gets. */
export function lifecycleTasks(fixture: (packDir: string) => string): Record<string, TaskDefinition> {
  return {
    "restore-mine": {
      title: "Put my library back",
      description:
        "Restores the library you had before the latest run, with no restart. When a run is mid-way (paused or stopped), its library is kept first and given back when it goes on, so pause a run, use the app, and resume.",
      run: async ({ h, state, run }) => {
        await giveOriginal(h, state, run !== null, run ? `run ${run.id} is ${run.status}` : "no run is mid-way");
        if (!run) await putAiBack(h, state);
      },
    },
    "bench-library": {
      title: "Load the bench library",
      description: "Backs your library up (pinned), then loads bench-library.json: from its pinned backup when the fixture hasn't changed, else by importing it. Put my library back undoes it.",
      run: async ({ h, state, run, packDir }) => {
        if (state.get(K.holds) !== "run") {
          state.set(K.original, await backup(h, state, `${NOTE}: your library before Load the bench library`, { pin: true }));
          state.set(K.holds, "run");
        }
        if (run) h.log(`Run ${run.id} is ${run.status}: it gets the bench library as it is now.`);
        await loadBenchLibrary(h, state, fixture(packDir));
      },
    },
    "backup-now": {
      title: "Back up now",
      description: "A backup of the library as it is, pinned and noted, so nothing prunes it.",
      readOnly: true,
      run: async ({ h, state }) => {
        const name = await backup(h, state, `${NOTE}: backed up by hand`, { pin: true });
        h.log(`Saved backup ${name} (pinned).`);
      },
    },
    "library-report": {
      title: "Library report",
      description: "What is in the library, whose library is live, the backups (and which this pack made) and the AI settings, as a log.",
      readOnly: true,
      run: async ({ h, state }) => {
        for (const line of (await report(h, state)).split("\n")) if (line) h.log(line);
      },
    },
    "reset-ai": {
      title: "Put the AI settings back",
      description: "Deleting, auto-apply and the tool format as they were before the latest run.",
      run: ({ h, state }) => putAiBack(h, state),
    },
    "clean-up": {
      title: "Clean up the bench's backups",
      description:
        "Deletes the backups this pack made (the bench library's too) and unpins what it pinned for a run. Refuses while a run is mid-way or while a run's library is live: Put my library back first.",
      run: async ({ h, state, run }) => {
        if (run) throw new StepError(`Run ${run.id} is ${run.status}; finish or delete it first, it may still need these backups.`);
        if (state.get(K.holds) === "run") throw new StepError("A run's library is live, and its backups hold yours: run Put my library back first.");
        await unprotect(h, state);
        const made = new Set(state.get<string[]>(K.made) ?? []);
        const keep = state.get<string>(K.original); // your library before the latest run
        let n = 0;
        for (const b of await listBackups(h)) {
          if (!made.has(b.name) || b.name === keep) continue;
          if (b.pinned) await setPinned(h, b.name, false);
          await deleteBackup(h, b.name);
          n++;
        }
        state.set(K.made, keep ? [keep] : []);
        for (const k of [K.baseline, K.baselineHash, K.runData]) state.delete(k);
        if (keep) await setPinned(h, keep, false);
        h.log(`Deleted ${n} backup(s) this pack made. Kept ${keep ?? "none"} (your library before the latest run, unpinned now).`);
      },
    },
  };
}
