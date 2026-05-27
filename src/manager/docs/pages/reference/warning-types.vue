<script setup lang="ts">
import DocPage from "../../../components/docs/DocPage.vue";
import DocSection from "../../../components/docs/DocSection.vue";
import DocCallout from "../../../components/docs/DocCallout.vue";
import CrossLinks from "../../../components/docs/CrossLinks.vue";

interface WarningRow { key: string; severity: string; desc: string }

const runtimeWarnings: WarningRow[] = [
  { key: "unknown_var", severity: "warn", desc: "A $var reference in a template or combine was not found in the Context." },
  { key: "unknown_ref", severity: "warn", desc: "An @{uuid} nested ref could not be resolved (uuid not in catalog or not upstream)." },
  { key: "recursion_limit", severity: "warn", desc: "Nested ref resolution exceeded the recursion depth limit." },
  { key: "cycle_detected", severity: "warn", desc: "A circular @{uuid} chain was detected and halted." },
  { key: "var_out_of_surface", severity: "warn", desc: "A $var read was attempted in a surface that does not support it (e.g. wildcard option)." },
  { key: "ref_subcategory_empty_pool", severity: "warn", desc: "An @{uuid}:subcat filter left an empty option pool; pick falls back to all options." },
  { key: "fixed_values_overrides_malformed", severity: "warn", desc: "The values_overrides payload on a Fixed Values instance could not be parsed." },
  { key: "unknown_constraint_mode", severity: "warn", desc: "A Constraint module specified an unrecognized reweight mode; entry is skipped." },
  { key: "constraint_factor_ignored_on_allow", severity: "info", desc: "A factor was provided with mode 'allow'; factor has no effect in allow mode." },
  { key: "unknown_constraint_source", severity: "warn", desc: "The constraint's source wildcard id was not found in the module stack." },
  { key: "constraint_excludes_all_options", severity: "warn", desc: "Constraint reweighting zeroed out every option; pick falls back to the unweighted pool." },
  { key: "constraint_never_applied", severity: "info", desc: "A constraint module was consumed by carrier-claim but its target wildcard never appeared downstream; constraint had no effect." },
  { key: "injector_invalid_binding", severity: "warn", desc: "An Injector row has a binding name that fails the variable name validation regex." },
  { key: "injector_reserved_binding", severity: "warn", desc: "An Injector row attempts to bind a name starting with __ (reserved for internal keys)." },
];

const scannerRules: WarningRow[] = [
  { key: "shadows_upstream", severity: "info", desc: "A variable set by this Context is also set by an upstream Context (last write wins; advisory only)." },
  { key: "duplicate_variable", severity: "warn", desc: "Two modules in the same Context write to the same $var name; the lower one overrides." },
  { key: "missing_template_variable", severity: "warn", desc: "The Assembler template references a $var that no upstream module produces." },
  { key: "constraint_source_missing", severity: "warn", desc: "A constraint's source wildcard uuid is not found in the catalog." },
  { key: "constraint_target_missing", severity: "warn", desc: "A constraint's target wildcard uuid is not found in the catalog." },
  { key: "constraint_orphan_source", severity: "warn", desc: "No source instance is upstream of the constraint in the current chain." },
  { key: "constraint_orphan_target", severity: "warn", desc: "No available target instance is downstream of the constraint (count-aware: N constraints targeting the same wildcard need N downstream instances)." },
  { key: "injector_binding_missing", severity: "warn", desc: "An Injector row's binding name doesn't match any variable produced upstream." },
];
</script>

<template>
  <DocPage
    group="Reference"
    title="Warning &amp; conflict types"
    icon="pi pi-list"
    tone="neutral"
    blurb="Every runtime warning + advisory scanner rule, with severity and one-line meaning."
  >
    <DocCallout variant="tip">
      The conflict scanner is <b>advisory only</b> and never blocks execution. Runtime warnings
      surface in the <b>WP Debug</b> node's Warnings tab. Both the scanner and the runtime follow
      last-write-wins semantics — they report but do not prevent.
    </DocCallout>

    <DocSection title="Runtime warnings">
      <div class="wp-doc-warn-table-wrap">
        <table class="wp-doc-warn-table">
          <thead>
            <tr>
              <th>Warning key</th>
              <th>Severity</th>
              <th>Meaning</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in runtimeWarnings" :key="row.key">
              <td class="wp-doc-warn-table__key">{{ row.key }}</td>
              <td>
                <span class="wp-doc-warn-badge" :class="`wp-doc-warn-badge--${row.severity}`">{{ row.severity }}</span>
              </td>
              <td class="wp-doc-warn-table__desc">{{ row.desc }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </DocSection>

    <DocSection title="Scanner rules (advisory)">
      <div class="wp-doc-warn-table-wrap">
        <table class="wp-doc-warn-table">
          <thead>
            <tr>
              <th>Rule key</th>
              <th>Severity</th>
              <th>Meaning</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in scannerRules" :key="row.key">
              <td class="wp-doc-warn-table__key">{{ row.key }}</td>
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
.wp-doc-warn-table__key {
  font-family: var(--wp-font-mono);
  font-size: 11.5px;
  color: var(--wp-text);
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
