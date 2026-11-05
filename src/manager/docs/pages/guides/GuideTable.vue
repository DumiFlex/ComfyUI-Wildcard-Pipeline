<script setup lang="ts">
/**
 * GuideTable — the plain data table the Guides pages share. Cells are
 * strings; text inside `backticks` renders as code. Kept as a real
 * <table> so the docs index reads it as " | " separated cells.
 */
defineProps<{ head: string[]; rows: string[][] }>();

function parts(s: string): { text: string; code: boolean }[] {
  return s.split("`").map((text, i) => ({ text, code: i % 2 === 1 })).filter((p) => p.text);
}
</script>

<template>
  <div class="wp-guide-scroll">
    <table class="wp-guide-table">
      <thead><tr><th v-for="h in head" :key="h">{{ h }}</th></tr></thead>
      <tbody>
        <tr v-for="(row, ri) in rows" :key="ri">
          <td v-for="(cell, ci) in row" :key="ci"><template v-for="(p, pi) in parts(cell)" :key="pi"><code v-if="p.code" class="wp-guide-code">{{ p.text }}</code><template v-else>{{ p.text }}</template></template></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.wp-guide-scroll { overflow-x: auto; }
.wp-guide-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--wp-bg-1);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-lg);
  font-size: 12.5px;
}
.wp-guide-table th {
  text-align: left;
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--wp-text-dim);
  font-weight: 600;
  padding: 9px 12px;
  background: var(--wp-bg-2);
  border-bottom: 1px solid var(--wp-border);
}
.wp-guide-table td {
  padding: 9px 12px;
  border-bottom: 1px solid var(--wp-border);
  vertical-align: top;
  color: var(--wp-text-muted);
  line-height: 1.55;
}
.wp-guide-table td:first-child { color: var(--wp-text); font-weight: 500; }
.wp-guide-table tr:last-child td { border-bottom: none; }
.wp-guide-code { font-family: var(--wp-font-mono); font-size: 0.92em; color: var(--wp-text); }
</style>
