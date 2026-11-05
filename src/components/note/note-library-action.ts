/**
 * Pressing a WP Note's `wp:library` button: collect what the workflow
 * carries, show the review dialog, install it all in one import commit
 * (the same checks as the Import tab), rebind the workflow, and offer Undo.
 *
 * Its own chunk: it brings the import pipeline (and, through it, Zod).
 */
import { createApp, h } from "vue";
import { app } from "#comfyui/app";
import { api } from "../../manager/api/client";
import { installEnvelope, type LibrarySnapshot } from "../../manager/import-export/install";
import { MAX_KNOWN_SCHEMA_VERSION } from "../../manager/import-export/migrations";
import { newShortId } from "../../manager/utils/ids";
import { serializeWidgetJson } from "../../widgets/_shared";
import { pushToast } from "../shared/toast-store";
import { bundleHashes, forceRefresh, hashes } from "../context/drift-store";
import NoteLibraryDialog from "./NoteLibraryDialog.vue";
import { canvasContexts, liveVerdicts, writeContext, type CanvasContext } from "./note-library-graph";
import { buildInstall, buildPlan, countLabel, rebindContext, type Choice, type LibraryPlan } from "./note-library-plan";

let running = false;

/** Asks the review dialog; null when cancelled. */
function review(plan: LibraryPlan, scope: string, existing: Record<string, string>): Promise<Record<string, Choice> | null> {
  return new Promise((resolve) => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const dialog = createApp({
      render: () => h(NoteLibraryDialog, {
        plan, scope, existing,
        onDone: (choices: Record<string, Choice> | null) => {
          resolve(choices);
          // Let the closing transition play.
          setTimeout(() => { dialog.unmount(); el.remove(); }, 300);
        },
      }),
    });
    dialog.mount(el);
  });
}

/** Library names of the items that clash, for the dialog. */
async function existingNames(plan: LibraryPlan): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(plan.items.filter((i) => i.state !== "new").map(async (i) => {
    try {
      const row = i.kind === "bundle" ? await api.bundles.get(i.id) : await api.modules.get(i.id);
      out[`${i.kind}:${i.id}`] = row.name;
    } catch { /* the dialog shows it without a name */ }
  }));
  return out;
}

function librarySnapshot(): LibrarySnapshot {
  const modules: LibrarySnapshot["modules"] = new Map();
  for (const [id, row] of Object.entries(hashes.value ?? {})) modules.set(id, { id, name: "", ...(row.type ? { type: row.type } : {}) });
  const bundles: LibrarySnapshot["bundles"] = new Map();
  for (const id of Object.keys(bundleHashes.value ?? {})) bundles.set(id, { id, name: "" });
  return { modules, bundles };
}

/** Run the button for the whole workflow (`node` "") or one WP Context. */
export async function runLibraryInstall(node: string): Promise<void> {
  if (running) return;
  running = true;
  try {
    await install(node);
  } finally {
    running = false;
  }
}

async function install(node: string): Promise<void> {
  const contexts = canvasContexts(app.graph, node);
  if (contexts.length === 0) {
    pushToast(node ? "That WP Context isn't on this canvas any more." : "This workflow has no WP Context.", { severity: "warning" });
    return;
  }
  await forceRefresh();
  if (hashes.value === null || bundleHashes.value === null) {
    pushToast("Couldn't read your library. Is ComfyUI still running?", { severity: "error" });
    return;
  }
  const plan = buildPlan(contexts, liveVerdicts, newShortId);
  if (plan.items.length === 0) {
    pushToast("Everything here is already in your library.", { severity: "info" });
    return;
  }
  const scope = node ? (contexts[0]?.label ?? "this WP Context") : "this workflow";
  const choices = await review(plan, scope, await existingNames(plan));
  if (!choices) return;

  const build = buildInstall(plan, choices, newShortId, MAX_KNOWN_SCHEMA_VERSION);
  if (build.count === 0) return;
  const replace = new Set(build.replace);
  const result = await installEnvelope({ envelope: build.envelope }, {
    importExport: api.importExport,
    library: librarySnapshot(),
    // Replace where the dialog said so; anything else that turned up in
    // the library since keeps the library's copy.
    resolveCollisions: async (rows) => Object.fromEntries(rows.map((r) => [r.id, replace.has(r.id) && !r.typeConflict ? { kind: "replace" as const } : { kind: "skip" as const }])),
  });
  if (!result.ok || !result.commit) {
    pushToast(`Nothing was added: ${result.error?.message ?? "the library refused it"}`, { severity: "error", lifeMs: 9000 });
    return;
  }

  await forceRefresh();
  const written = rebindAll(contexts, plan, build);
  const undoId = result.commit.undo_entry_id;
  pushToast(`Added ${countLabel(build.going)} to your library.`, {
    severity: "success",
    lifeMs: 12000,
    action: { label: "Undo", onSelect: () => void undo(undoId, written) },
  });
}

/** Rebind every Context in scope; returns what was written, to put back on Undo. */
function rebindAll(contexts: CanvasContext[], plan: LibraryPlan, build: ReturnType<typeof buildInstall>): Array<{ ctx: CanvasContext; json: string }> {
  const written: Array<{ ctx: CanvasContext; json: string }> = [];
  for (const ctx of contexts) {
    const next = rebindContext(ctx.key, ctx.value, {
      rename: build.rename,
      minted: plan.minted,
      installedModules: build.installedModules,
      installedBundles: build.installedBundles,
      moduleHash: (id) => hashes.value?.[id]?.payload_hash,
      bundleHash: (id) => bundleHashes.value?.[id],
    });
    if (!next) continue;
    const json = serializeWidgetJson(next);
    writeContext(ctx.node, json);
    written.push({ ctx, json });
  }
  return written;
}

async function undo(undoId: string, written: Array<{ ctx: CanvasContext; json: string }>): Promise<void> {
  try {
    await api.importExport.undo(undoId);
  } catch (err) {
    pushToast(`Undo failed: ${err instanceof Error ? err.message : String(err)}`, { severity: "error" });
    return;
  }
  // Put each Context back the way it was, unless it has been edited since.
  for (const { ctx, json } of written) {
    const w = ctx.node.widgets?.find((x) => x.name === "wp_modules");
    if (w?.value === json) writeContext(ctx.node, ctx.raw);
  }
  await forceRefresh();
  pushToast("Taken back out of your library.", { severity: "info" });
}
