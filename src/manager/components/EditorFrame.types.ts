/**
 * EditorFrame shared types.
 *
 * SaveState drives the Save button's state-machine visuals
 * (idle / saving / saved / error). Lives in a sibling .ts file
 * because Vue 3 `<script setup>` blocks can't cleanly re-export
 * named types, and we want every editor to import the same union.
 */
export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * EditorSection — opt-in side-rail anchor for long editors.
 *
 * `id` matches the DOM id of the corresponding card (or card-wrapper
 * `<div>`) in the editor body; `label` is the human-readable rail
 * link. EditorFrame renders the rail only when 3+ sections are
 * provided — fewer than that and the column isn't worth the space.
 */
export interface EditorSection {
  id: string;
  label: string;
}
