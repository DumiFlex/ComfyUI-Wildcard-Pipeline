<script setup lang="ts">
import Badge from "@/components/shared/Badge.vue";
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";

// Human-readable labels — what the hover message / Warnings-tab line actually
// conveys — NOT the internal rule names. Severity drives the dot colour.
type Severity = "warn" | "info";
interface WarningRow { label: string; severity: Severity; desc: string }
const SEVERITY: Record<Severity, string> = { warn: "Warning", info: "Info" };

const runtimeWarnings: WarningRow[] = [
  { label: "Unknown variable", severity: "warn", desc: "A template or combine used a $variable nothing set, so it printed nothing." },
  { label: "Reference not found", severity: "warn", desc: "An @{…} reference points at a wildcard that wasn't found on the node or in the library." },
  { label: "Filter matched no options", severity: "warn", desc: "A reference's tag filter left no options, so it printed nothing." },
  { label: "Reference not allowed here", severity: "warn", desc: "An @{…} reference sits somewhere that can't use one, such as a combine or the Assembler, so it printed nothing." },
  { label: "Variable not allowed here", severity: "warn", desc: "A $variable was written somewhere that can't read one, such as a wildcard option. It printed as typed." },
  { label: "Unknown tag axis", severity: "warn", desc: "A $name.GROUP read names a group that isn't an accepts group on that wildcard, so it printed nothing." },
  { label: "Pick has no tag on this axis", severity: "info", desc: "The picked option has no tag from the accepts group being read, so $name.GROUP printed nothing." },
  { label: "References nested too deep", severity: "warn", desc: "References inside references went too many levels deep, so the deepest ones were left out." },
  { label: "Reference cycle", severity: "warn", desc: "References pointed back at each other in a circle; the circle was cut so the run could finish." },
  { label: "Constraint never applied", severity: "info", desc: "The constraint's target never ran after it (or wasn't drawn this run), so it changed nothing." },
  { label: "Constraint partial reach", severity: "info", desc: "A constraint set to reach the next N (or picked) uses of its target found fewer than that." },
  { label: "Constraint source missing", severity: "warn", desc: "The constraint's source wildcard hadn't run yet when the constraint was reached." },
  { label: "Constraint excluded every option", severity: "warn", desc: "The constraint ruled out every option of the target and there was no fallback, so it printed nothing." },
  { label: "Fallback used", severity: "info", desc: "Nothing was left to pick, so the wildcard's fallback option stood in." },
  { label: "No option matches the variable", severity: "info", desc: "A wildcard set to Match variable found no option equal to the variable's value and has no fallback, so it rolled as usual." },
  { label: "Pinned option missing", severity: "warn", desc: "A sweep frame (or other pin) points at an option the wildcard no longer has, so that frame rolled instead." },
  { label: "Constraint factor ignored (allow)", severity: "info", desc: "A rule set to Allow also has a number; Allow ignores it." },
  { label: "Unknown constraint mode", severity: "warn", desc: "A constraint rule has a mode this version doesn't know (probably from a newer pack), so the rule was skipped." },
  { label: "Fixed-values overrides malformed", severity: "warn", desc: "The node-only changes on a Fixed Values row couldn't be read, so the library values were used." },
  { label: "Constraint failed to register", severity: "warn", desc: "A constraint couldn't be set up, usually because its data is damaged. It was skipped." },
  { label: "Module failed", severity: "warn", desc: "A module hit an error and was skipped. The message says which." },
  { label: "Invalid injector name", severity: "warn", desc: "A WP Context Injector row used a variable name that isn't valid." },
  { label: "Reserved injector name", severity: "warn", desc: "A WP Context Injector row name starts with two underscores, which are kept for the engine." },
];

const scannerRules: WarningRow[] = [
  { label: "Shadowed variable", severity: "info", desc: "An earlier Context already sets this variable, and this one replaces it. Normal when chaining; shown so you know." },
  { label: "Duplicate variable", severity: "warn", desc: "Two modules on the same Context set the same variable; the lower one wins." },
  { label: "Missing variable in template", severity: "warn", desc: "The Assembler template uses a $variable nothing before it sets (or one that is hidden)." },
  { label: "Constraint source not found", severity: "warn", desc: "A constraint points at a source wildcard that isn't in your library." },
  { label: "Constraint target not found", severity: "warn", desc: "A constraint points at a target wildcard that isn't in your library." },
  { label: "Constraint source not upstream", severity: "warn", desc: "The source wildcard isn't above the constraint, so there's no pick for it to react to." },
  { label: "Constraint target not downstream", severity: "warn", desc: "The target wildcard isn't below the constraint (or the constraint's reach covers none of its uses), so it can't change anything." },
  { label: "Rules out all (no fallback)", severity: "warn", desc: "For some source picks, every option of the target is ruled out and there's no fallback, so it would print nothing. The hover message names those picks. Allow at least one option for them, or set a fallback." },
  { label: "Injector binding unmatched", severity: "warn", desc: "A WP Context Injector row names a variable that nothing before it sets." },
  { label: "Unknown tag group", severity: "warn", desc: "A $name.GROUP read names a group that isn't an accepts group on that wildcard, so it prints nothing. Make the tag group accepts, or fix the name." },
  { label: "Option missing an accepts tag", severity: "info", desc: "Some options have no tag from an accepts group, so $name.GROUP is empty when they're picked. Tag them, or leave it if empty is fine." },
];
</script>

<template>
  <DocPage
    group="Reference"
    title="Warning &amp; conflict types"
    icon="pi pi-list"
    tone="neutral"
    blurb="What each warning on the canvas and in WP Debug means, and what to do about it."
  >
    <DocCallout variant="tip">
      On the canvas each one shows as a coloured dot and a short label on the node; hover for the
      message. After a run they're listed in WP Debug's <b>Warnings</b> tab. None of them stops a
      run. Blue is for your information, amber is worth a look.
    </DocCallout>

    <DocSection title="As you build (canvas)">
      <p>These show on the nodes while you build:</p>
      <div class="wp-doc-warn-table-wrap">
        <table class="wp-doc-warn-table">
          <thead>
            <tr>
              <th>What it flags</th>
              <th>Severity</th>
              <th>What it means</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in scannerRules" :key="row.label">
              <td class="wp-doc-warn-table__label">{{ row.label }}</td>
              <td>
                <Badge dot :tone="row.severity" :text="SEVERITY[row.severity]" />
              </td>
              <td class="wp-doc-warn-table__desc">{{ row.desc }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </DocSection>

    <DocSection title="After a run (WP Debug → Warnings)">
      <p>These show up once you run. The labels match what WP Debug shows.</p>
      <div class="wp-doc-warn-table-wrap">
        <table class="wp-doc-warn-table">
          <thead>
            <tr>
              <th>What it flags</th>
              <th>Severity</th>
              <th>What it means</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in runtimeWarnings" :key="row.label">
              <td class="wp-doc-warn-table__label">{{ row.label }}</td>
              <td>
                <Badge dot :tone="row.severity" :text="SEVERITY[row.severity]" />
              </td>
              <td class="wp-doc-warn-table__desc">{{ row.desc }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </DocSection>

    <DocSection title="See also">
      <CrossLinks
        :links="[
          { id: 'conflicts-and-warnings', label: 'Conflicts &amp; warnings', icon: 'pi pi-share-alt', tone: 'neutral' },
          { id: 'wp-debug', label: 'WP Debug', icon: 'pi pi-eye', tone: 'node' },
          { id: 'constraints', label: 'Constraints in depth', icon: 'pi pi-share-alt', tone: 'neutral' },
        ]"
      />
    </DocSection>
  </DocPage>
</template>

<style scoped>
.wp-doc-warn-table-wrap {
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-lg);
  overflow: hidden;
}
.wp-doc-warn-table {
  width: 100%;
  border-collapse: collapse;
}
.wp-doc-warn-table th {
  text-align: left;
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--wp-text-dim);
  font-weight: 600;
  padding: 9px 14px;
  background: var(--wp-bg-2);
  border-bottom: 1px solid var(--wp-border);
}
.wp-doc-warn-table td {
  padding: 9px 14px;
  font-size: 12.5px;
  border-bottom: 1px solid var(--wp-border);
  vertical-align: top;
}
.wp-doc-warn-table tr:last-child td { border-bottom: none; }
.wp-doc-warn-table__label {
  color: var(--wp-text);
  font-weight: 500;
  white-space: nowrap;
}
.wp-doc-warn-table__desc { color: var(--wp-text-muted); line-height: 1.5; }
</style>
