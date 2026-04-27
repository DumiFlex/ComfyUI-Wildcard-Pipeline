/* global React, WP_DATA, KIND_META, relTime, Icon, Button, Card, classNames */

function Dashboard({ onNavigate, onCreate }) {
  const stats = [
    { label: "Pipelines",     value: WP_DATA.pipelines.length,  icon: "pi-list",  delta: "+1 this week", screen: "pipelines" },
    { label: "Wildcards",     value: WP_DATA.wildcards.length,  icon: "pi-th-large",  delta: "+2 this week", screen: "wildcards" },
    { label: "Fixed Values",  value: WP_DATA.fixedValues.length,icon: "pi-tag",        delta: "+1 this week", screen: "fixed" },
    { label: "Total Modules", value:
        WP_DATA.wildcards.length + WP_DATA.fixedValues.length +
        WP_DATA.combines.length + WP_DATA.derivations.length + WP_DATA.constraints.length,
      icon: "pi-database", delta: "+5 this week" },
  ];

  return (
    <div className="wp-page">
      {/* Hero */}
      <div className="wp-hero">
        <div className="wp-hero__icon"><img src="assets/logo-color.png" alt="" /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="wp-hero__title">Welcome to Wildcard Pipeline</h2>
          <p className="wp-hero__sub">
            Manage modules — wildcards, fixed values, combines, derivations and constraints — that drop into ComfyUI prompts as snapshots.
          </p>
        </div>
        <div className="wp-hsplit" style={{ gap: 8 }}>
          <Button variant="outline" icon="pi-book" onClick={() => {}}>Docs</Button>
          <Button variant="primary" icon="pi-plus" onClick={() => onCreate("wildcard")}>New module</Button>
        </div>
      </div>

      {/* Stats */}
      <div className="wp-stats">
        {stats.map((s) => (
          <div className="wp-stat" key={s.label} role={s.screen ? "button" : undefined} tabIndex={s.screen ? 0 : undefined}
               onClick={s.screen ? () => onNavigate(s.screen) : undefined}
               onKeyDown={(e) => s.screen && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onNavigate(s.screen))}
               style={s.screen ? { cursor: "pointer" } : undefined}>
            <div className="wp-stat__icon"><Icon name={s.icon} /></div>
            <div className="wp-stat__label">{s.label}</div>
            <div className="wp-stat__value">{s.value}</div>
            <div className="wp-stat__delta"><Icon name="pi-arrow-up-right" style={{ fontSize: 9 }} /> {s.delta}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: 14 }}>
        {/* Recent edits */}
        <Card title="Recent Edits" padded={false} action={
          <Button variant="ghost" size="sm" iconRight="pi-arrow-right" onClick={() => onNavigate("wildcards")}>View all</Button>
        }>
          <div className="wp-list">
            {WP_DATA.recentEdits.map((r) => {
              const m = KIND_META[r.kind];
              const target = ({ wildcard: "wildcards", fixed: "fixed", combine: "combines", derivation: "derivations", constraint: "constraints", pipeline: "pipelines" })[r.kind] || "wildcards";
              return (
                <div className="wp-list__row" key={r.id} role="button" tabIndex={0}
                     onClick={() => onNavigate(target)}
                     onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onNavigate(target))}>
                  <span style={{
                    width: 22, height: 22, borderRadius: 6, display: "grid", placeItems: "center",
                    background: `color-mix(in oklab, ${m.color} 18%, transparent)`,
                    color: m.color, fontSize: 11,
                  }}>
                    <Icon name={m.icon} />
                  </span>
                  <span style={{ flex: 1, fontWeight: 500 }}>{r.name}</span>
                  <span className="wp-id">{r.id}</span>
                  <span className="wp-dim" style={{ width: 70, textAlign: "right", fontSize: 11.5 }}>{relTime(r.at)}</span>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Quick actions */}
        <Card title="Quick Actions">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Button variant="primary" icon="pi-plus" onClick={() => onCreate("pipeline")} style={{ gridColumn: "1 / -1" }}>New Pipeline</Button>
            <Button variant="outline" icon="pi-plus" onClick={() => onCreate("wildcard")}>Wildcard</Button>
            <Button variant="outline" icon="pi-plus" onClick={() => onCreate("fixed")}>Fixed Values</Button>
            <Button variant="outline" icon="pi-plus" onClick={() => onCreate("combine")}>Combine</Button>
            <Button variant="outline" icon="pi-plus" onClick={() => onCreate("derivation")}>Derivation</Button>
            <Button variant="outline" icon="pi-plus" onClick={() => onCreate("constraint")} style={{ gridColumn: "1 / -1" }}>Constraint</Button>
          </div>
          <div className="wp-divider" style={{ margin: "12px 0" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Button variant="ghost" icon="pi-bolt" onClick={() => onNavigate("test")}>Open test runner</Button>
            <Button variant="ghost" icon="pi-arrow-right-arrow-left" onClick={() => onNavigate("io")}>Import / Export</Button>
          </div>
        </Card>
      </div>

      {/* Pipeline preview — small explainer of how modules chain */}
      <Card title="Pipeline at a glance">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
          {[
            { kind: "wildcard",   note: "Pick a weighted option per resolve." },
            { kind: "fixed",      note: "Bind named string variables." },
            { kind: "combine",    note: "Merge upstream values via template." },
            { kind: "constraint", note: "Bias matrix between wildcards." },
            { kind: "derivation", note: "Mutate output post-resolve." },
          ].map((s, i) => {
            const m = KIND_META[s.kind];
            return (
              <div key={s.kind} style={{
                background: "var(--wp-bg-2)",
                border: "1px solid var(--wp-border)",
                borderRadius: 10, padding: 12,
                display: "flex", flexDirection: "column", gap: 6,
                position: "relative",
              }}>
                <div style={{
                  position: "absolute", top: 10, right: 10,
                  fontFamily: "var(--wp-font-mono)", fontSize: 10, color: "var(--wp-text-dim)",
                }}>{String(i + 1).padStart(2, "0")}</div>
                <div style={{
                  width: 28, height: 28, borderRadius: 8, display: "grid", placeItems: "center",
                  background: `color-mix(in oklab, ${m.color} 16%, transparent)`,
                  color: m.color, fontSize: 13,
                }}>
                  <Icon name={m.icon} />
                </div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{m.label}</div>
                <div className="wp-dim" style={{ fontSize: 11.5, lineHeight: 1.45 }}>{s.note}</div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

Object.assign(window, { Dashboard });
