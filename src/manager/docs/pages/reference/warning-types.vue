<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";

// Human-readable labels — what the hover message / Warnings-tab line actually
// conveys — NOT the internal rule names. Severity drives the dot colour.
interface WarningRow { label: string; severity: string; desc: string }

const runtimeWarnings: WarningRow[] = [
  { label: "Unknown variable", severity: "warn", desc: "A $variable used in a template or combine was never set by any module, so it rendered literally." },
  { label: "Unresolved reference", severity: "warn", desc: "An @{…} nested reference couldn't be resolved — its target wildcard wasn't found, or wasn't upstream." },
  { label: "Reference nested too deep", severity: "warn", desc: "Nested @{…} references went past the depth limit and stopped expanding." },
  { label: "Circular reference", severity: "warn", desc: "A loop of @{…} references pointed back at itself; it was broken to avoid hanging." },
  { label: "Variable used where it can't be", severity: "warn", desc: "A $variable was read somewhere that doesn't support one (for example, inside a wildcard option)." },
  { label: "Sub-category filter matched nothing", severity: "warn", desc: "An @{…} sub-category filter left no options, so the pick fell back to the full pool." },
  { label: "Fixed Values override unreadable", severity: "warn", desc: "A Fixed Values instance's per-instance overrides couldn't be read, so they were ignored." },
  { label: "Unknown constraint mode", severity: "warn", desc: "A constraint used a reweight mode that isn't recognised; that entry was skipped." },
  { label: "Factor ignored (Allow)", severity: "info", desc: "A factor was set together with mode Allow, where the factor has no effect." },
  { label: "Constraint source missing at run", severity: "warn", desc: "The constraint's source wildcard wasn't present in the stack when the run reached it." },
  { label: "Constraint excluded everything", severity: "warn", desc: "Reweighting zeroed out every option on the target, so the pick fell back to the full pool." },
  { label: "Constraint never fired", severity: "info", desc: "A constraint was set up but its target wildcard never came up this run, so it had no effect." },
  { label: "Invalid injector name", severity: "warn", desc: "A WP Context Injector row used a variable name that isn't valid." },
  { label: "Reserved injector name", severity: "warn", desc: "A WP Context Injector row tried to use a name starting with __, which is reserved internally." },
];

const scannerRules: WarningRow[] = [
  { label: "Shadowed variable", severity: "info", desc: "An upstream Context already sets this variable; this one overrides it (last write wins). Normal when chaining — shown so the override is visible." },
  { label: "Duplicate variable", severity: "warn", desc: "Two modules in the same Context set the same variable name; the lower one wins." },
  { label: "Missing variable in template", severity: "warn", desc: "The Prompt Assembler template references a $variable that no upstream module produces." },
  { label: "Constraint source not found", severity: "warn", desc: "A constraint points at a source wildcard that isn't in your library." },
  { label: "Constraint target not found", severity: "warn", desc: "A constraint points at a target wildcard that isn't in your library." },
  { label: "Constraint source not upstream", severity: "warn", desc: "The constraint's source wildcard doesn't appear before the constraint in the chain, so it can't read a pick from it." },
  { label: "Constraint target not downstream", severity: "warn", desc: "No copy of the target wildcard appears after the constraint. Each constraint needs its own downstream target — N constraints on the same wildcard need N copies." },
  { label: "Injector binding unmatched", severity: "warn", desc: "A WP Context Injector row names a variable that nothing upstream produces." },
];
</script>

<template>
  <DocPage
    group="Reference"
    title="Warning &amp; conflict types"
    icon="pi pi-list"
    tone="neutral"
    blurb="Every condition the canvas flags as you build, and every warning a run can produce — with how serious it is and what it means."
  >
    <DocCallout variant="tip">
      You don't look these up by name — on the canvas each shows as a coloured dot + short label on
      the node (hover for the message), and after a run they're listed in the <b>WP Debug</b> node's
      <b>Warnings</b> tab. Everything here is <b>advisory</b>: it reports, it never blocks a run.
      Blue = info, amber = worth a look.
    </DocCallout>

    <DocSection title="As you build (canvas)">
      <p>The scanner watches your graph and flags these straight away:</p>
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
                <span class="wp-doc-warn-badge" :class="`wp-doc-warn-badge--${row.severity}`">{{ row.severity }}</span>
              </td>
              <td class="wp-doc-warn-table__desc">{{ row.desc }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </DocSection>

    <DocSection title="After a run (WP Debug → Warnings)">
      <p>These only become clear during an actual generation:</p>
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
                <span class="wp-doc-warn-badge" :class="`wp-doc-warn-badge--${row.severity}`">{{ row.severity }}</span>
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
.wp-doc-warn-badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 2px 7px;
  border-radius: 999px;
  white-space: nowrap;
}
.wp-doc-warn-badge--warn {
  color: var(--wp-warn);
  background: color-mix(in oklab, var(--wp-warn) 12%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-warn) 30%, transparent);
}
.wp-doc-warn-badge--info {
  color: var(--wp-info);
  background: color-mix(in oklab, var(--wp-info) 10%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-info) 28%, transparent);
}
.wp-doc-warn-badge--danger {
  color: var(--wp-danger);
  background: color-mix(in oklab, var(--wp-danger) 10%, transparent);
  border: 1px solid color-mix(in oklab, var(--wp-danger) 28%, transparent);
}
</style>
