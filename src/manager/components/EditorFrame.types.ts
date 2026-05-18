/**
 * EditorFrame shared types.
 *
 * SaveState drives the Save button's state-machine visuals
 * (idle / saving / saved / error). Lives in a sibling .ts file
 * because Vue 3 `<script setup>` blocks can't cleanly re-export
 * named types, and we want every editor to import the same union.
 */
export type SaveState = "idle" | "saving" | "saved" | "error";
