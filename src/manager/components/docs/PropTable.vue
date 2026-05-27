<script setup lang="ts">
export interface PropRow { name: string; type: string; required?: boolean; desc: string }
defineProps<{ rows: PropRow[] }>();
</script>
<template>
  <div class="wp-doc-ptable-wrap">
    <table class="wp-doc-ptable">
      <thead><tr><th>Port / widget</th><th>Type</th><th>Description</th></tr></thead>
      <tbody>
        <tr v-for="r in rows" :key="r.name">
          <td class="wp-doc-ptable__nm">{{ r.name }} <span v-if="r.required === false" class="wp-doc-ptable__opt">optional</span></td>
          <td class="wp-doc-ptable__ty">{{ r.type }}</td>
          <td class="wp-doc-ptable__ds">{{ r.desc }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
<style scoped>
.wp-doc-ptable-wrap { background: var(--wp-bg-1); border: 1px solid var(--wp-border); border-radius: var(--wp-radius-lg); overflow: hidden; }
.wp-doc-ptable { width: 100%; border-collapse: collapse; }
.wp-doc-ptable th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--wp-text-dim); font-weight: 600; padding: 9px 14px; background: var(--wp-bg-2); border-bottom: 1px solid var(--wp-border); }
.wp-doc-ptable td { padding: 10px 14px; font-size: 12.5px; border-bottom: 1px solid var(--wp-border); vertical-align: top; }
.wp-doc-ptable tr:last-child td { border-bottom: none; }
.wp-doc-ptable__nm { font-family: var(--wp-font-mono); color: var(--wp-text); font-size: 12px; }
.wp-doc-ptable__opt { color: var(--wp-text-dim); font-family: var(--wp-font); font-size: 10.5px; }
.wp-doc-ptable__ty { font-family: var(--wp-font-mono); font-size: 11px; color: var(--wp-text-muted); }
.wp-doc-ptable__ds { color: var(--wp-text-muted); }
</style>
