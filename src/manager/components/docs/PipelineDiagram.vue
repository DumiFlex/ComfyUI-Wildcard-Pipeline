<template>
  <div class="wp-doc-diagram">
    <div class="wp-doc-diagram__cap">modules inside the Context</div>
    <div class="wp-doc-diagram__feeders">
      <span class="wp-doc-diagram__feeder"><i class="pi pi-sparkles wp-doc-diagram__feeder-icon wp-doc-diagram__feeder-icon--wildcard" aria-hidden="true"></i>Wildcard</span>
      <span class="wp-doc-diagram__feeder"><i class="pi pi-tag wp-doc-diagram__feeder-icon wp-doc-diagram__feeder-icon--fixed" aria-hidden="true"></i>Fixed Values</span>
      <span class="wp-doc-diagram__feeder"><i class="pi pi-link wp-doc-diagram__feeder-icon wp-doc-diagram__feeder-icon--combine" aria-hidden="true"></i>Combine</span>
      <span class="wp-doc-diagram__feeder"><i class="pi pi-arrow-right-arrow-left wp-doc-diagram__feeder-icon wp-doc-diagram__feeder-icon--derivation" aria-hidden="true"></i>Derivation</span>
      <span class="wp-doc-diagram__feeder"><i class="pi pi-filter wp-doc-diagram__feeder-icon wp-doc-diagram__feeder-icon--constraint" aria-hidden="true"></i>Constraint</span>
    </div>
    <div class="wp-doc-diagram__downarrow" aria-hidden="true"><i class="pi pi-angle-down"></i></div>
    <div class="wp-doc-diagram__flow">
      <div class="wp-doc-diagram__stage">
        <div class="wp-doc-diagram__node-box wp-doc-diagram__node-box--wp">
          <span class="wp-doc-diagram__node-ico"><i class="pi pi-sitemap" aria-hidden="true"></i></span>
          <span class="wp-doc-diagram__node-nm">WP Context</span>
          <span class="wp-doc-diagram__node-id">rolls + resolves</span>
        </div>
      </div>
      <div class="wp-doc-diagram__arrow" aria-hidden="true">
        <span class="wp-doc-diagram__arrow-lbl">emits</span>
        <span class="wp-doc-diagram__arrow-ln"></span>
      </div>
      <div class="wp-doc-diagram__stage">
        <div class="wp-doc-diagram__varbag">
          <div class="wp-doc-diagram__varchips">
            <span class="wp-doc-diagram__vchip wp-doc-diagram__vchip--a">$subject</span>
            <span class="wp-doc-diagram__vchip wp-doc-diagram__vchip--b">$style</span>
            <span class="wp-doc-diagram__vchip wp-doc-diagram__vchip--c">$lighting</span>
          </div>
          <span class="wp-doc-diagram__var-label">resolved $vars</span>
        </div>
      </div>
      <div class="wp-doc-diagram__arrow" aria-hidden="true">
        <span class="wp-doc-diagram__arrow-lbl">fills</span>
        <span class="wp-doc-diagram__arrow-ln"></span>
      </div>
      <div class="wp-doc-diagram__stage">
        <div class="wp-doc-diagram__node-box wp-doc-diagram__node-box--wp">
          <span class="wp-doc-diagram__node-ico"><i class="pi pi-align-left" aria-hidden="true"></i></span>
          <span class="wp-doc-diagram__node-nm">Prompt Assembler</span>
          <span class="wp-doc-diagram__node-id">"A $style portrait…"</span>
        </div>
      </div>
      <div class="wp-doc-diagram__arrow" aria-hidden="true">
        <span class="wp-doc-diagram__arrow-lbl">prompt</span>
        <span class="wp-doc-diagram__arrow-ln"></span>
      </div>
      <div class="wp-doc-diagram__stage">
        <div class="wp-doc-diagram__node-box wp-doc-diagram__node-box--ext">
          <span class="wp-doc-diagram__node-ico"><i class="pi pi-bolt" aria-hidden="true"></i></span>
          <span class="wp-doc-diagram__node-nm">CLIP Encode</span>
          <span class="wp-doc-diagram__node-id">conditioning</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wp-doc-diagram {
  background: radial-gradient(120% 100% at 0% 0%, color-mix(in oklab, var(--wp-node) 6%, transparent), transparent 60%), var(--wp-bg-1);
  border: 1px solid var(--wp-border);
  border-radius: var(--wp-radius-lg);
  padding: 22px 20px;
}
.wp-doc-diagram__cap {
  text-align: center;
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--wp-text-dim);
  margin-bottom: 7px;
}
.wp-doc-diagram__feeders {
  display: flex;
  gap: 6px;
  justify-content: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.wp-doc-diagram__feeder {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 10.5px;
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border);
  color: var(--wp-text-muted);
}
.wp-doc-diagram__feeder-icon { font-size: 10px; }
.wp-doc-diagram__feeder-icon--wildcard { color: var(--wp-kind-wildcard); }
.wp-doc-diagram__feeder-icon--fixed { color: var(--wp-kind-fixed); }
.wp-doc-diagram__feeder-icon--combine { color: var(--wp-kind-combine); }
.wp-doc-diagram__feeder-icon--derivation { color: var(--wp-kind-derivation); }
.wp-doc-diagram__feeder-icon--constraint { color: var(--wp-kind-constraint); }
.wp-doc-diagram__downarrow {
  display: flex;
  justify-content: center;
  color: var(--wp-text-dim);
  margin: -2px 0 12px;
  font-size: 13px;
}
.wp-doc-diagram__flow {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.wp-doc-diagram__stage {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  text-align: center;
}
.wp-doc-diagram__node-box {
  min-width: 120px;
  padding: 11px 13px;
  border-radius: 10px;
  background: var(--wp-bg-2);
  border: 1px solid var(--wp-border-strong);
  display: flex;
  flex-direction: column;
  gap: 3px;
  align-items: center;
}
.wp-doc-diagram__node-box--wp { border-color: color-mix(in oklab, var(--wp-node) 55%, transparent); }
.wp-doc-diagram__node-box--wp .wp-doc-diagram__node-ico { color: var(--wp-node); }
.wp-doc-diagram__node-box--ext .wp-doc-diagram__node-ico { color: var(--wp-text-muted); }
.wp-doc-diagram__node-ico { font-size: 16px; }
.wp-doc-diagram__node-nm { font-size: 12px; font-weight: 600; }
.wp-doc-diagram__node-id { font-family: var(--wp-font-mono); font-size: 9.5px; color: var(--wp-text-dim); }
.wp-doc-diagram__arrow {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  color: var(--wp-text-dim);
  padding: 0 4px;
  min-width: 46px;
}
.wp-doc-diagram__arrow-lbl {
  font-size: 9.5px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  margin-bottom: 5px;
  color: var(--wp-text-dim);
}
.wp-doc-diagram__arrow-ln {
  height: 2px;
  width: 100%;
  background: linear-gradient(90deg, transparent, var(--wp-border-strong) 20%, var(--wp-border-strong) 80%, transparent);
  position: relative;
  display: block;
}
.wp-doc-diagram__arrow-ln::after {
  content: "";
  position: absolute;
  right: 0;
  top: -3px;
  border: 4px solid transparent;
  border-left-color: var(--wp-border-strong);
}
.wp-doc-diagram__varbag {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
}
.wp-doc-diagram__varchips {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
  justify-content: center;
  max-width: 150px;
}
.wp-doc-diagram__vchip {
  font-family: var(--wp-font-mono);
  font-size: 10.5px;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid;
  background: var(--wp-bg-2);
}
.wp-doc-diagram__vchip--a { color: var(--wp-accent-text); border-color: color-mix(in oklab, var(--wp-accent-500) 40%, transparent); }
.wp-doc-diagram__vchip--b { color: #67e8f9; border-color: color-mix(in oklab, #22d3ee 40%, transparent); }
.wp-doc-diagram__vchip--c { color: #86efac; border-color: color-mix(in oklab, #34d399 40%, transparent); }
.wp-doc-diagram__var-label {
  font-size: 9.5px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--wp-text-dim);
}
</style>
