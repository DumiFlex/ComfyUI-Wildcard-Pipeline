/* global React, WP_DATA, Icon, Button, Field, Input, Card, Chip, Select, Checkbox, Toggle, PageHeader, classNames */
const { useState, useMemo, useRef } = React;

// ---------- Categories ----------
// Mini color picker: native <input type="color"> swatch + hex input + preset palette.
function ColorField({ value, onChange }) {
  const palette = ["#a78bfa", "#22d3ee", "#fbbf24", "#f472b6", "#60a5fa", "#34d399", "#f87171", "#fb923c"];
  const isValidHex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
  return (
    <div className="wp-color-picker">
      <label className="wp-color-picker__swatch" title="Open color picker"
             style={{ background: isValidHex ? value : "transparent", borderColor: isValidHex ? "transparent" : "var(--wp-border-strong)" }}>
        <input type="color" value={isValidHex ? value : "#a78bfa"} onChange={(e) => onChange(e.target.value)} />
      </label>
      <div className="wp-input-group" style={{ width: 120 }}>
        <span className="wp-input-group__addon">#</span>
        <input
          className="wp-input wp-mono"
          value={value.replace(/^#/, "")}
          onChange={(e) => {
            const raw = e.target.value.toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, 6);
            onChange("#" + raw);
          }}
          placeholder="a78bfa"
          maxLength={6}
        />
      </div>
      <div className="wp-color-picker__palette">
        {palette.map((c) => (
          <button key={c} type="button" onClick={() => onChange(c)} title={c}
            className="wp-color-picker__chip"
            data-active={value.toLowerCase() === c.toLowerCase()}
            style={{ background: c }} />
        ))}
      </div>
    </div>
  );
}

function CategoriesScreen({ items, setItems }) {
  const [draft, setDraft] = useState("");
  const [color, setColor] = useState("#a78bfa");
  const [editing, setEditing] = useState(null); // { id, name, color }
  const add = () => {
    if (!draft.trim()) return;
    setItems([...items, { id: "cat_" + Math.random().toString(36).slice(2, 7), name: draft.trim(), color }]);
    setDraft("");
  };
  const del = (id) => setItems(items.filter((c) => c.id !== id));
  const startEdit = (c) => setEditing({ id: c.id, name: c.name, color: c.color });
  const saveEdit = () => {
    if (!editing) return;
    setItems(items.map((c) => c.id === editing.id ? { ...c, name: editing.name.trim() || c.name, color: editing.color } : c));
    setEditing(null);
  };

  return (
    <div className="wp-page wp-page--fill">
      <PageHeader title="Categories" subtitle="Tag groups for filtering modules. Color appears on category chips in the DataTable." />

      <Card title="New category">
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <Field label="Name" style={{ flex: 1, minWidth: 200 }}>
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Style" onKeyDown={(e) => e.key === "Enter" && add()} />
          </Field>
          <Field label="Color">
            <ColorField value={color} onChange={setColor} />
          </Field>
          <Button variant="primary" icon="pi-plus" onClick={add}>Add</Button>
        </div>
      </Card>

      <div className="wp-table-wrap wp-table-wrap--scroll">
        <table className="wp-table wp-table--sticky-head">
          <thead>
            <tr>
              <th>Name</th>
              <th style={{ width: 360 }}>Color</th>
              <th style={{ width: 110 }}>Modules</th>
              <th style={{ width: 110, textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={4}><div className="wp-empty"><div className="wp-empty__icon"><Icon name="pi-bookmark" /></div><div className="wp-dim">No categories yet.</div></div></td></tr>}
            {items.map((c) => {
              const count = WP_DATA.wildcards.filter((w) => w.category === c.id).length
                + WP_DATA.fixedValues.filter((w) => w.category === c.id).length;
              const isEditing = editing && editing.id === c.id;
              return (
                <tr key={c.id}>
                  <td>
                    {isEditing
                      ? <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && saveEdit()} autoFocus />
                      : <Chip color={c.color}>{c.name}</Chip>}
                  </td>
                  <td>
                    {isEditing
                      ? <ColorField value={editing.color} onChange={(v) => setEditing({ ...editing, color: v })} />
                      : <span className="wp-mono wp-dim" style={{ fontSize: 11.5 }}>{c.color}</span>}
                  </td>
                  <td className="wp-mono">{count}</td>
                  <td style={{ textAlign: "right" }}>
                    {isEditing ? (
                      <div style={{ display: "inline-flex", gap: 4 }}>
                        <Button size="sm" variant="primary" icon="pi-check" onClick={saveEdit} />
                        <Button size="sm" variant="ghost" icon="pi-times" onClick={() => setEditing(null)} />
                      </div>
                    ) : (
                      <div style={{ display: "inline-flex", gap: 4 }}>
                        <Button size="sm" variant="ghost" icon="pi-pencil" onClick={() => startEdit(c)} />
                        <Button size="sm" variant="ghost" icon="pi-trash" className="wp-btn--danger" onClick={() => del(c.id)} />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Import / Export ----------
function ImportExportScreen({ pushToast }) {
  const [mode, setMode] = useState("export"); // export | import
  return (
    <div className="wp-page">
      <PageHeader
        title="Import / Export"
        subtitle="Pick exactly what to ship in or out — full library, by kind, or individual modules. Workflow files are NOT handled here."
      />
      <div className="wp-tabs" style={{ marginBottom: 4 }}>
        <button className="wp-tab" data-active={mode === "export"} onClick={() => setMode("export")}>
          <Icon name="pi-download" /> Export
        </button>
        <button className="wp-tab" data-active={mode === "import"} onClick={() => setMode("import")}>
          <Icon name="pi-upload" /> Import
        </button>
      </div>
      {mode === "export" ? <ExportPanel pushToast={pushToast} /> : <ImportPanel pushToast={pushToast} />}
    </div>
  );
}

// All module groups for selection UI
const MODULE_GROUPS = [
  { key: "wildcards",   label: "Wildcards",    icon: "pi-th-large",   color: "#a78bfa", get: () => WP_DATA.wildcards },
  { key: "fixedValues", label: "Fixed Values", icon: "pi-tag",        color: "#22d3ee", get: () => WP_DATA.fixedValues },
  { key: "combines",    label: "Combines",     icon: "pi-share-alt",  color: "#34d399", get: () => WP_DATA.combines },
  { key: "derivations", label: "Derivations",  icon: "pi-code",       color: "#fbbf24", get: () => WP_DATA.derivations },
  { key: "constraints", label: "Constraints",  icon: "pi-sitemap",    color: "#f472b6", get: () => WP_DATA.constraints },
  { key: "categories",  label: "Categories",   icon: "pi-bookmark",   color: "#60a5fa", get: () => WP_DATA.categories },
];

function ExportPanel({ pushToast }) {
  // Selection state: Set of "kind:id"
  const [sel, setSel] = useState(() => {
    const s = new Set();
    MODULE_GROUPS.forEach((g) => g.get().forEach((it) => s.add(`${g.key}:${it.id}`)));
    return s;
  });
  const [search, setSearch] = useState("");
  const [openGroups, setOpenGroups] = useState(() => new Set(["wildcards", "fixedValues"]));

  const toggle = (key) => setSel((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const setAllInGroup = (g, on) => setSel((s) => {
    const n = new Set(s);
    g.get().forEach((it) => {
      const k = `${g.key}:${it.id}`;
      if (on) n.add(k); else n.delete(k);
    });
    return n;
  });
  const allOn = () => setSel(new Set(MODULE_GROUPS.flatMap((g) => g.get().map((it) => `${g.key}:${it.id}`))));
  const allOff = () => setSel(new Set());
  const toggleGroup = (key) => setOpenGroups((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const totalItems = MODULE_GROUPS.reduce((a, g) => a + g.get().length, 0);
  const selCount = sel.size;
  const estBytes = selCount * 420 + 240;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 14, alignItems: "start" }}>
      <Card
        title="Pick what to export"
        padded={false}
        action={
          <div className="wp-hsplit" style={{ gap: 6 }}>
            <Button size="sm" variant="ghost" onClick={allOn}>Select all</Button>
            <Button size="sm" variant="ghost" onClick={allOff}>None</Button>
          </div>
        }
      >
        <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--wp-border)" }}>
          <div className="wp-input-group">
            <span className="wp-input-group__addon"><Icon name="pi-search" /></span>
            <input className="wp-input" placeholder="Search modules to filter…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div style={{ maxHeight: 480, overflow: "auto" }}>
          {MODULE_GROUPS.map((g) => {
            const items = g.get().filter((it) => !search.trim() || (it.name || "").toLowerCase().includes(search.toLowerCase()) || (it.id || "").toLowerCase().includes(search.toLowerCase()));
            const groupSel = items.filter((it) => sel.has(`${g.key}:${it.id}`)).length;
            const allChecked = items.length > 0 && groupSel === items.length;
            const someChecked = !allChecked && groupSel > 0;
            const open = openGroups.has(g.key) || !!search.trim();
            return (
              <div key={g.key} style={{ borderBottom: "1px solid var(--wp-border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: "var(--wp-bg-2)", cursor: "pointer" }}
                  onClick={() => toggleGroup(g.key)}>
                  <div onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={allChecked} indeterminate={someChecked} onChange={(on) => setAllInGroup(g, on)} />
                  </div>
                  <span style={{ width: 22, height: 22, borderRadius: 6, display: "grid", placeItems: "center",
                    background: `color-mix(in oklab, ${g.color} 18%, transparent)`, color: g.color, fontSize: 11 }}>
                    <Icon name={g.icon} />
                  </span>
                  <span style={{ fontWeight: 500 }}>{g.label}</span>
                  <span className="wp-dim" style={{ fontSize: 11.5 }}>{groupSel} / {items.length} selected</span>
                  <div className="wp-spacer" />
                  <Icon name={open ? "pi-chevron-down" : "pi-chevron-right"} style={{ fontSize: 11, color: "var(--wp-text-dim)" }} />
                </div>
                {open && items.length > 0 && (
                  <div>
                    {items.map((it) => {
                      const k = `${g.key}:${it.id}`;
                      const cat = WP_DATA.categories.find((c) => c.id === it.category);
                      return (
                        <div key={k} className="wp-list__row" style={{ padding: "7px 12px 7px 36px", borderRadius: 0, borderTop: "1px solid var(--wp-border)" }}
                          onClick={() => toggle(k)}>
                          <Checkbox checked={sel.has(k)} onChange={() => toggle(k)} />
                          <span style={{ fontSize: 12.5, fontWeight: 500, flex: 1 }}>{it.name}</span>
                          {cat && <Chip color={cat.color}>{cat.name}</Chip>}
                          <span className="wp-id">{it.id}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {open && items.length === 0 && (
                  <div className="wp-dim" style={{ padding: "10px 12px 10px 36px", fontSize: 12 }}>No matches.</div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, position: "sticky", top: 0 }}>
        <Card title="Bundle summary">
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", rowGap: 6, fontSize: 12.5 }}>
            <span className="wp-dim">Selected</span><span className="wp-mono">{selCount} / {totalItems}</span>
            <span className="wp-dim">Bundle version</span><span className="wp-mono">1</span>
            <span className="wp-dim">Est. size</span><span className="wp-mono">{(estBytes / 1024).toFixed(1)} KB</span>
          </div>
          <div className="wp-divider" style={{ margin: "10px 0" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Button variant="primary" icon="pi-download" disabled={selCount === 0}
              onClick={() => pushToast(`Exported ${selCount} item${selCount === 1 ? "" : "s"}.`)}>
              Export selection
            </Button>
            <Button variant="ghost" icon="pi-copy" disabled={selCount === 0}
              onClick={() => pushToast("Copied JSON to clipboard.")}>
              Copy as JSON
            </Button>
          </div>
        </Card>
        <Card title="Quick presets">
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Button size="sm" variant="ghost" icon="pi-database" onClick={allOn}>Full library</Button>
            <Button size="sm" variant="ghost" icon="pi-th-large" onClick={() => setSel(new Set(WP_DATA.wildcards.map((w) => `wildcards:${w.id}`)))}>Wildcards only</Button>
            <Button size="sm" variant="ghost" icon="pi-star-fill" onClick={() => {
              const s = new Set();
              MODULE_GROUPS.forEach((g) => g.get().forEach((it) => { if (it.favorite) s.add(`${g.key}:${it.id}`); }));
              setSel(s);
            }}>Favorites only</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function ImportPanel({ pushToast }) {
  const fileRef = useRef(null);
  const [imported, setImported] = useState(null);
  // Mock parsed contents — appear after file pick
  const [parsed, setParsed] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [conflictMode, setConflictMode] = useState("rename");

  const handleFile = (file) => {
    if (!file) return;
    setImported({ name: file.name, size: (file.size / 1024).toFixed(1) });
    // Mock parsed bundle preview
    const mock = {
      wildcards: [
        { id: "wc_imp_a01", name: "Pose", items: 5, conflict: false },
        { id: "wc_3f9b1a",  name: "Hair Color", items: 6, conflict: true },
      ],
      fixedValues: [
        { id: "fv_imp_b01", name: "Studio Defaults", items: 4, conflict: false },
      ],
      combines: [
        { id: "cb_imp_c01", name: "Outfit Phrase", items: 2, conflict: false },
      ],
      categories: [
        { id: "cat_mood", name: "Mood", items: 1, conflict: false },
      ],
    };
    setParsed(mock);
    const all = new Set();
    Object.entries(mock).forEach(([k, arr]) => arr.forEach((it) => all.add(`${k}:${it.id}`)));
    setSel(all);
  };

  const toggle = (key) => setSel((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const totalParsed = parsed ? Object.values(parsed).reduce((a, b) => a + b.length, 0) : 0;
  const conflicts = parsed ? Object.entries(parsed).flatMap(([k, arr]) => arr.filter((it) => it.conflict).map((it) => ({ ...it, kind: k }))) : [];

  return (
    <div style={{ display: "grid", gridTemplateColumns: parsed ? "1fr 280px" : "1fr", gap: 14, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Card title="Source bundle">
          <p className="wp-dim" style={{ fontSize: 12.5, marginTop: 0 }}>
            Drop a <span className="wp-mono">.wp.json</span> bundle. You'll see its contents listed before anything is merged — pick exactly what you want.
          </p>
          <input ref={fileRef} type="file" accept=".json,.wp.json" hidden onChange={(e) => handleFile(e.target.files?.[0])} />
          <div onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]); }}
            style={{
              border: "1px dashed var(--wp-border-strong)",
              borderRadius: 10, padding: 24, textAlign: "center",
              cursor: "pointer", background: "var(--wp-bg-2)", marginTop: 8,
            }}>
            <Icon name="pi-cloud-upload" style={{ fontSize: 22, color: "var(--wp-text-muted)" }} />
            <div style={{ marginTop: 6, fontSize: 13 }}>{imported ? imported.name : "Drop a .wp.json file or click to browse"}</div>
            <div className="wp-dim" style={{ fontSize: 11.5, marginTop: 2 }}>{imported ? `${imported.size} KB · click to replace` : "Up to 10 MB"}</div>
          </div>
        </Card>

        {parsed && (
          <Card title="Pick what to import" padded={false} action={
            <div className="wp-hsplit" style={{ gap: 6 }}>
              <Button size="sm" variant="ghost" onClick={() => {
                const all = new Set();
                Object.entries(parsed).forEach(([k, arr]) => arr.forEach((it) => all.add(`${k}:${it.id}`)));
                setSel(all);
              }}>Select all</Button>
              <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>None</Button>
            </div>
          }>
            <div>
              {Object.entries(parsed).map(([kind, arr]) => {
                const g = MODULE_GROUPS.find((m) => m.key === kind);
                if (!g) return null;
                return (
                  <div key={kind} style={{ borderBottom: "1px solid var(--wp-border)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: "var(--wp-bg-2)" }}>
                      <span style={{ width: 22, height: 22, borderRadius: 6, display: "grid", placeItems: "center",
                        background: `color-mix(in oklab, ${g.color} 18%, transparent)`, color: g.color, fontSize: 11 }}>
                        <Icon name={g.icon} />
                      </span>
                      <span style={{ fontWeight: 500 }}>{g.label}</span>
                      <span className="wp-dim" style={{ fontSize: 11.5 }}>{arr.length} in bundle</span>
                    </div>
                    {arr.map((it) => {
                      const k = `${kind}:${it.id}`;
                      return (
                        <div key={k} className="wp-list__row" style={{ padding: "7px 12px 7px 36px", borderRadius: 0, borderTop: "1px solid var(--wp-border)" }}
                          onClick={() => toggle(k)}>
                          <Checkbox checked={sel.has(k)} onChange={() => toggle(k)} />
                          <span style={{ fontSize: 12.5, fontWeight: 500, flex: 1 }}>{it.name}</span>
                          {it.conflict && <Chip variant="warn" icon="pi-exclamation-triangle">Conflict</Chip>}
                          <span className="wp-id">{it.id}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>

      {parsed && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, position: "sticky", top: 0 }}>
          <Card title="Import summary">
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", rowGap: 6, fontSize: 12.5 }}>
              <span className="wp-dim">Will import</span><span className="wp-mono">{sel.size} / {totalParsed}</span>
              <span className="wp-dim">Conflicts</span><span className="wp-mono" style={{ color: conflicts.length ? "var(--wp-warn)" : undefined }}>{conflicts.length}</span>
            </div>
            <div className="wp-divider" style={{ margin: "10px 0" }} />
            <Field label="On conflict">
              <Select value={conflictMode} onChange={setConflictMode}
                options={[
                  { value: "rename",    label: "Rename (keep both)" },
                  { value: "overwrite", label: "Overwrite existing" },
                  { value: "skip",      label: "Skip conflicting items" },
                ]} />
            </Field>
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              <Button variant="primary" icon="pi-check" disabled={sel.size === 0}
                onClick={() => { pushToast(`Imported ${sel.size} item${sel.size === 1 ? "" : "s"}.`); setParsed(null); setImported(null); setSel(new Set()); }}>
                Import {sel.size} item{sel.size === 1 ? "" : "s"}
              </Button>
              <Button variant="ghost" icon="pi-times" onClick={() => { setParsed(null); setImported(null); setSel(new Set()); }}>Cancel</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ---------- Test runner ----------
// Mock engine that resolves modules the way the real backend does.
// Used by the Test Runner to show realistic per-kind output.
const TR_ENGINE = (() => {
  const pickWeighted = (opts) => {
    const total = opts.reduce((a, b) => a + (Number(b.weight) || 0), 0);
    if (total <= 0) return opts[0]?.value || "";
    let r = Math.random() * total;
    for (const o of opts) { r -= (Number(o.weight) || 0); if (r <= 0) return o.value || ""; }
    return opts[opts.length - 1]?.value || "";
  };
  // Expand inline {a|b|c} choices randomly (one branch per occurrence).
  const expandInline = (s) =>
    String(s).replace(/\{([^{}]*\|[^{}]*)\}/g, (_, body) => {
      const parts = body.split("|");
      return parts[Math.floor(Math.random() * parts.length)];
    });
  const resolveWildcard = (w, ctx) => {
    if (!w?.options?.length) return "";
    let raw = pickWeighted(w.options);
    // 1) inline {a|b|c} choices
    raw = expandInline(raw);
    // 2) @{var} and @var nested references
    return String(raw)
      .replace(/@\{([a-z_][a-z0-9_]*)\}/gi, (_, n) => (ctx?.[n] !== undefined ? ctx[n] : (resolveByVar(n) || "")))
      .replace(/@([a-z_][a-z0-9_]*)/gi, (_, n) => (ctx?.[n] !== undefined ? ctx[n] : (resolveByVar(n) || "")));
  };
  const resolveByVar = (varName) => {
    const w = WP_DATA.wildcards.find((x) => x.varBinding === varName);
    if (w) return resolveWildcard(w);
    for (const f of WP_DATA.fixedValues) {
      const v = f.values.find((x) => x.var === varName);
      if (v) return v.value;
    }
    return "";
  };
  const fillTemplate = (tpl, ctx) =>
    tpl
      .replace(/@\{([a-z_][a-z0-9_]*)\}/gi, (_, name) =>
        ctx[name] !== undefined ? ctx[name] : (resolveByVar(name) || `@{${name}}`)
      )
      .replace(/\$([a-z_][a-z0-9_]*)/gi, (_, name) =>
        ctx[name] !== undefined ? ctx[name] : (resolveByVar(name) || `$${name}`)
      );
  const evalCondition = (cond, ctx) => {
    if (!cond) return false;
    if (cond.kind === "always") return true;
    const lhs = (ctx[cond.var] ?? "").toString().toLowerCase();
    const rhs = (cond.value ?? "").toString().toLowerCase();
    if (cond.kind === "contains") return lhs.includes(rhs);
    if (cond.kind === "equals")   return lhs === rhs;
    return false;
  };
  const applyAction = (action, ctx) => {
    if (!action) return;
    const tgt = action.target || "subject";
    const val = action.value || "";
    if (!val) return;
    if (action.kind === "replace") ctx[tgt] = val;
    else ctx[tgt] = ctx[tgt] ? ctx[tgt] + ", " + val : val;
  };
  const evalDerivation = (d, ctx) => {
    const trace = [];
    for (const rule of d.rules || []) {
      let fired = null;
      for (let i = 0; i < (rule.branches || []).length; i++) {
        const br = rule.branches[i];
        if (evalCondition(br.condition, ctx)) {
          applyAction(br.action, ctx);
          fired = { branch: i, kind: "if/elif", action: br.action };
          break;
        }
      }
      if (!fired && rule.hasElse && rule.else?.value) {
        applyAction(rule.else, ctx);
        fired = { branch: -1, kind: "else", action: rule.else };
      }
      trace.push(fired || { branch: null, kind: "skip" });
    }
    return trace;
  };
  // Constraint: produces an effective option list for the target wildcard given a source value.
  const applyConstraint = (cn, sourceValue) => {
    const target = WP_DATA.wildcards.find((w) => w.id === cn.target);
    const source = WP_DATA.wildcards.find((w) => w.id === cn.source);
    if (!target || !source) return target?.options || [];
    const tSubs = target.subCategories || [];
    const sSubs = source.subCategories || [];
    const sIdx = source.options.findIndex((o) => o.value === sourceValue);
    const sSub = source.options[sIdx]?.sub || "";
    const sCol = sSubs.indexOf(sSub);
    const result = target.options.map((opt, i) => {
      const tRow = tSubs.indexOf(opt.sub || "");
      let mode = "allow";
      if (cn.matrix && tRow >= 0 && sCol >= 0 && cn.matrix[tRow]?.[sCol]) {
        mode = cn.matrix[tRow][sCol];
      }
      const ex = (cn.exceptions || []).find((e) => e.from === sourceValue && e.to === opt.value);
      if (ex) mode = ex.mode;
      let w = Number(opt.weight) || 0;
      if (mode === "exclude") w = 0;
      if (mode === "reduce")  w = w * 0.25;
      if (mode === "boost")   w = w * 3;
      return { ...opt, weight: w, _mode: mode };
    });
    return result;
  };
  return { pickWeighted, resolveWildcard, resolveByVar, fillTemplate, evalCondition, applyAction, evalDerivation, applyConstraint, expandInline };
})();

const TR_KIND_OPTIONS = [
  { value: "pipeline",   label: "Pipeline",   icon: "pi-list" },
  { value: "wildcard",   label: "Wildcard",   icon: "pi-th-large" },
  { value: "combine",    label: "Combine",    icon: "pi-sitemap" },
  { value: "constraint", label: "Constraint", icon: "pi-lock" },
  { value: "derivation", label: "Derivation", icon: "pi-bolt" },
  { value: "fixed",      label: "Fixed",      icon: "pi-tag" },
];

const TR_LIST_BY_KIND = {
  pipeline:   () => WP_DATA.pipelines,
  wildcard:   () => WP_DATA.wildcards,
  combine:    () => WP_DATA.combines,
  constraint: () => WP_DATA.constraints,
  derivation: () => WP_DATA.derivations,
  fixed:      () => WP_DATA.fixedValues,
};

// Bar — small reusable horizontal bar with label + count.
function TRBar({ label, value, max, accent }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  const color = accent || "var(--wp-accent-500)";
  return (
    <>
      <div className="wp-mono" style={{ fontSize: 12, color: "var(--wp-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
      <div style={{ height: 18, background: "var(--wp-bg-3)", borderRadius: 6, overflow: "hidden", position: "relative" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: `linear-gradient(90deg, ${color}, color-mix(in oklab, ${color} 60%, white))`, borderRadius: 6, transition: "width .25s" }} />
      </div>
      <div className="wp-mono" style={{ textAlign: "right", fontSize: 12 }}>{value}</div>
    </>
  );
}

function TestRunnerScreen() {
  const [kind, setKind] = useState("pipeline");
  const [moduleId, setModuleId] = useState(WP_DATA.pipelines[0]?.id || "");
  const [samples, setSamples] = useState(50);
  const [results, setResults] = useState(null);
  const [running, setRunning] = useState(false);
  const [traceOpen, setTraceOpen] = useState(0);  // index of expanded trace sample (or -1)

  // When kind changes, reset selected module.
  const list = TR_LIST_BY_KIND[kind]();
  React.useEffect(() => {
    if (!list.find((m) => m.id === moduleId)) {
      setModuleId(list[0]?.id || "");
      setResults(null);
    }
  }, [kind]); // eslint-disable-line

  const mod = list.find((m) => m.id === moduleId);
  const meta = KIND_META[kind];

  // Kind-specific summary blurb under the config card.
  const summary = (() => {
    if (!mod) return null;
    if (kind === "wildcard") {
      const total = mod.options.reduce((a, b) => a + (Number(b.weight) || 0), 0);
      return <>Resolves into <span className="wp-mono" style={{ color: "var(--wp-accent-text)" }}>${mod.varBinding}</span> · <span className="wp-mono">{mod.options.length}</span> options · weight total <span className="wp-mono">{total}</span></>;
    }
    if (kind === "fixed")    return <><span className="wp-mono">{mod.values.length}</span> bindings · deterministic</>;
    if (kind === "combine")  return <>Template fills <span className="wp-mono">{mod.inputs.length}</span> input vars → <span className="wp-mono" style={{ color: "var(--wp-accent-text)" }}>{mod.output}</span></>;
    if (kind === "constraint") {
      const t = WP_DATA.wildcards.find((w) => w.id === mod.target);
      const s = WP_DATA.wildcards.find((w) => w.id === mod.source);
      return <>Mutates <span className="wp-mono" style={{ color: "var(--wp-accent-text)" }}>{t?.name}</span> based on <span className="wp-mono">{s?.name}</span> · {mod.exceptions.length} exception(s)</>;
    }
    if (kind === "derivation") return <><span className="wp-mono">{mod.rules.length}</span> rule(s) · post-resolve</>;
    if (kind === "pipeline")   return <><span className="wp-mono">{mod.steps.length}</span> step(s) · runs top-to-bottom</>;
    return null;
  })();

  const usesSamples = kind === "pipeline" || kind === "wildcard" || kind === "combine" || kind === "constraint";

  const run = () => {
    if (!mod) return;
    setRunning(true);
    setTraceOpen(0);
    setTimeout(() => {
      const N = usesSamples ? Math.max(1, samples) : 1;
      const out = { kind, samples: N, started: Date.now() };

      if (kind === "wildcard") {
        // Bin by the chosen option's raw template (so weights line up cleanly),
        // and collect a few resolved-sample strings for templates with refs/choices.
        const counts = Object.fromEntries(mod.options.map((o) => [o.value || "(empty)", 0]));
        const samplesByTpl = {};
        for (let i = 0; i < N; i++) {
          // Pick weighted, then expand — but we need to know WHICH option was picked.
          const total = mod.options.reduce((a, b) => a + (Number(b.weight) || 0), 0);
          let r = Math.random() * total;
          let picked = mod.options[0];
          for (const o of mod.options) { r -= (Number(o.weight) || 0); if (r <= 0) { picked = o; break; } }
          const tpl = picked.value || "(empty)";
          counts[tpl] = (counts[tpl] || 0) + 1;
          // Expand for sampling
          let resolved = TR_ENGINE.expandInline(picked.value || "");
          resolved = String(resolved)
            .replace(/@\{([a-z_][a-z0-9_]*)\}/gi, (_, n) => TR_ENGINE.resolveByVar(n) || `@{${n}}`)
            .replace(/@([a-z_][a-z0-9_]*)/gi,    (_, n) => TR_ENGINE.resolveByVar(n) || `@${n}`);
          if (resolved !== picked.value) {
            (samplesByTpl[tpl] = samplesByTpl[tpl] || []);
            if (samplesByTpl[tpl].length < 3 && !samplesByTpl[tpl].includes(resolved)) samplesByTpl[tpl].push(resolved);
          }
        }
        out.counts = counts;
        out.samplesByTpl = samplesByTpl;
        out.syntax = WP_DATA && window.getWildcardSyntax ? window.getWildcardSyntax(mod) : null;
      }

      if (kind === "fixed") {
        out.bindings = mod.values.map((v) => ({ var: v.var, value: v.value }));
      }

      if (kind === "combine") {
        const counts = {};
        const examples = [];
        for (let i = 0; i < N; i++) {
          const ctx = {};
          mod.inputs.forEach((iv) => { const name = iv.replace(/^\$/, ""); ctx[name] = TR_ENGINE.resolveByVar(name) || `$${name}`; });
          const filled = TR_ENGINE.fillTemplate(mod.template, ctx);
          counts[filled] = (counts[filled] || 0) + 1;
          if (examples.length < 6) examples.push({ ctx, filled });
        }
        out.counts = counts;
        out.examples = examples;
      }

      if (kind === "constraint") {
        const target = WP_DATA.wildcards.find((w) => w.id === mod.target);
        const source = WP_DATA.wildcards.find((w) => w.id === mod.source);
        const sourceValues = (source?.options || []).map((o) => o.value);
        // Build a before/after table for each source value
        out.target = target;
        out.source = source;
        out.rows = (target?.options || []).map((opt) => {
          const row = { value: opt.value, sub: opt.sub, before: Number(opt.weight) || 0, after: {} };
          sourceValues.forEach((sv) => {
            const eff = TR_ENGINE.applyConstraint(mod, sv);
            const matched = eff.find((e) => e.value === opt.value);
            row.after[sv] = matched || { weight: 0, _mode: "allow" };
          });
          return row;
        });
      }

      if (kind === "derivation") {
        // Simulate ONE run with a baseline ctx (made up), then show rule trace.
        // We seed ctx from common vars referenced by conditions.
        const ctx = { subject: "portrait of a person", scene: "outdoor", negative: "" };
        for (const rule of mod.rules || []) {
          for (const br of rule.branches || []) {
            if (br.condition?.var) ctx[br.condition.var] = ctx[br.condition.var] ?? TR_ENGINE.resolveByVar(br.condition.var);
          }
        }
        // For demo: try a few possible weather/lighting/etc values
        const seedVars = {};
        for (const rule of mod.rules || []) {
          for (const br of rule.branches || []) {
            if (br.condition?.var) seedVars[br.condition.var] = TR_ENGINE.resolveByVar(br.condition.var);
          }
        }
        Object.assign(ctx, seedVars);

        const before = { ...ctx };
        const trace = TR_ENGINE.evalDerivation(mod, ctx);
        out.before = before;
        out.after = ctx;
        out.trace = trace;
      }

      if (kind === "pipeline") {
        const samplesArr = [];
        const finalCounts = {};  // count of distinct (subject + scene) summaries
        for (let i = 0; i < N; i++) {
          const ctx = {};
          const stepTrace = [];
          for (const step of mod.steps) {
            if (step.enabled === false) { stepTrace.push({ kind: step.kind, name: "(disabled)", note: "skipped" }); continue; }
            if (step.kind === "wildcard") {
              const w = WP_DATA.wildcards.find((x) => x.id === step.refId);
              if (!w) continue;
              const v = TR_ENGINE.resolveWildcard(w, ctx);
              ctx[w.varBinding] = v;
              stepTrace.push({ kind: "wildcard", name: w.name, note: `$${w.varBinding} = ${v}` });
            } else if (step.kind === "fixed") {
              const f = WP_DATA.fixedValues.find((x) => x.id === step.refId);
              if (!f) continue;
              f.values.forEach((b) => { ctx[b.var] = b.value; });
              stepTrace.push({ kind: "fixed", name: f.name, note: f.values.map((b) => `$${b.var}`).join(", ") });
            } else if (step.kind === "combine") {
              const c = WP_DATA.combines.find((x) => x.id === step.refId);
              if (!c) continue;
              const filled = TR_ENGINE.fillTemplate(c.template, ctx);
              const outName = c.output.replace(/^\$/, "");
              ctx[outName] = filled;
              stepTrace.push({ kind: "combine", name: c.name, note: `$${outName} = "${filled.length > 60 ? filled.slice(0, 60) + "…" : filled}"` });
            } else if (step.kind === "constraint") {
              const cn = WP_DATA.constraints.find((x) => x.id === step.refId);
              if (!cn) continue;
              const target = WP_DATA.wildcards.find((w) => w.id === cn.target);
              const source = WP_DATA.wildcards.find((w) => w.id === cn.source);
              if (!target || !source) continue;
              const sv = ctx[source.varBinding];
              const eff = TR_ENGINE.applyConstraint(cn, sv);
              const newVal = TR_ENGINE.pickWeighted(eff);
              const oldVal = ctx[target.varBinding];
              ctx[target.varBinding] = newVal;
              stepTrace.push({ kind: "constraint", name: cn.name, note: oldVal !== newVal ? `$${target.varBinding}: ${oldVal} → ${newVal}` : `$${target.varBinding} = ${newVal} (kept)` });
            } else if (step.kind === "derivation") {
              const d = WP_DATA.derivations.find((x) => x.id === step.refId);
              if (!d) continue;
              const before = JSON.stringify(ctx);
              const tr = TR_ENGINE.evalDerivation(d, ctx);
              const fired = tr.filter((t) => t.kind !== "skip").length;
              stepTrace.push({ kind: "derivation", name: d.name, note: `${fired}/${tr.length} rule(s) fired`, changed: before !== JSON.stringify(ctx) });
            }
          }
          // Pick the "primary output" = last combine's output var if any,
          // else the longest resolved value in the context.
          let primary = "";
          for (let s = mod.steps.length - 1; s >= 0; s--) {
            if (mod.steps[s].kind === "combine") {
              const c = WP_DATA.combines.find((x) => x.id === mod.steps[s].refId);
              if (c) { primary = ctx[c.output.replace(/^\$/, "")] || ""; break; }
            }
          }
          if (!primary) {
            primary = Object.values(ctx).reduce((a, b) => (String(b).length > String(a).length ? b : a), "");
          }
          finalCounts[primary || "(empty)"] = (finalCounts[primary || "(empty)"] || 0) + 1;
          samplesArr.push({ ctx, trace: stepTrace, fp: primary });
        }
        out.runs = samplesArr;
        out.finalCounts = finalCounts;
      }

      setResults(out);
      setRunning(false);
    }, 200);
  };

  return (
    <div className="wp-page">
      <PageHeader title="Test Runner" subtitle="Resolve any module against the engine and inspect the output. Pipelines run end-to-end with a per-step trace." />

      <Card title="Configuration">
        <div style={{ display: "grid", gap: 12 }}>
          {/* Kind segmented control */}
          <Field label="Module kind">
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {TR_KIND_OPTIONS.map((k) => {
                const active = kind === k.value;
                const km = KIND_META[k.value];
                return (
                  <button key={k.value} type="button" onClick={() => { setKind(k.value); setResults(null); }}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "6px 10px", borderRadius: 6, fontSize: 12.5, cursor: "pointer",
                      border: active ? `1px solid ${km.color}` : "1px solid var(--wp-border)",
                      background: active ? `color-mix(in oklab, ${km.color} 18%, transparent)` : "var(--wp-bg-2)",
                      color: active ? km.color : "var(--wp-text)",
                    }}>
                    <Icon name={k.icon} style={{ fontSize: 11 }} /> {k.label}
                  </button>
                );
              })}
            </div>
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: usesSamples ? "minmax(220px, 1fr) 140px auto" : "minmax(220px, 1fr) auto", gap: 12, alignItems: "end" }}>
            <Field label="Module">
              <Select value={moduleId} onChange={setModuleId}
                options={list.map((m) => ({ value: m.id, label: m.name }))} />
            </Field>
            {usesSamples && (
              <Field label="Samples">
                <Input type="number" min={1} max={10000} value={samples} onChange={(e) => setSamples(Number(e.target.value) || 1)} />
              </Field>
            )}
            <Button variant="primary" icon="pi-bolt" onClick={run} disabled={running || !mod} style={{ minWidth: 110 }}>{running ? "Running…" : "Run"}</Button>
          </div>
        </div>
        {summary && (
          <div className="wp-dim" style={{ fontSize: 11.5, marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
            <Icon name={meta?.icon || "pi-link"} style={{ fontSize: 10, color: meta?.color }} />
            {summary}
          </div>
        )}
      </Card>

      {results && results.kind === "wildcard" && <TRWildcardResults results={results} onRerun={run} />}
      {results && results.kind === "fixed" && <TRFixedResults results={results} mod={mod} onRerun={run} />}
      {results && results.kind === "combine" && <TRCombineResults results={results} mod={mod} onRerun={run} />}
      {results && results.kind === "constraint" && <TRConstraintResults results={results} onRerun={run} />}
      {results && results.kind === "derivation" && <TRDerivationResults results={results} mod={mod} onRerun={run} />}
      {results && results.kind === "pipeline" && <TRPipelineResults results={results} mod={mod} onRerun={run} traceOpen={traceOpen} setTraceOpen={setTraceOpen} />}
    </div>
  );
}

function TRWildcardResults({ results, onRerun }) {
  const max = Math.max(...Object.values(results.counts));
  const hasSamples = results.samplesByTpl && Object.keys(results.samplesByTpl).length > 0;
  const sortedEntries = Object.entries(results.counts).sort((a, b) => b[1] - a[1]);
  return (
    <Card title={`Histogram — ${results.samples} samples`}
      action={<Button size="sm" variant="ghost" icon="pi-refresh" onClick={onRerun}>Re-run</Button>}>
      {results.syntax?.hasNested || results.syntax?.hasInline ? (
        <div className="wp-dim" style={{ fontSize: 11.5, marginBottom: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span>Bins are weighted by template;</span>
          {results.syntax.hasInline ? <span style={{ padding: "1px 6px", borderRadius: 4, background: "var(--wp-bg-3)", fontFamily: "var(--wp-font-mono)", fontSize: 11 }}>{`{a|b|c}`} expanded</span> : null}
          {results.syntax.hasNested ? <span style={{ padding: "1px 6px", borderRadius: 4, background: "var(--wp-bg-3)", fontFamily: "var(--wp-font-mono)", fontSize: 11 }}>@refs resolved</span> : null}
        </div>
      ) : null}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 280px) 1fr 50px", rowGap: 7, columnGap: 10, alignItems: "center" }}>
        {sortedEntries.map(([k, v]) => {
          const samples = results.samplesByTpl?.[k];
          return (
            <React.Fragment key={k}>
              <div style={{ minWidth: 0 }}>
                <div className="wp-mono" style={{ fontSize: 12, color: "var(--wp-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k}</div>
                {samples?.length ? (
                  <div className="wp-mono wp-dim" style={{ fontSize: 11, marginTop: 2, lineHeight: 1.45 }}>
                    {samples.map((s, i) => (
                      <div key={i} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>↳ {s}</div>
                    ))}
                  </div>
                ) : null}
              </div>
              <div style={{ height: 18, background: "var(--wp-bg-3)", borderRadius: 6, overflow: "hidden", position: "relative" }}>
                <div style={{ width: `${(v / max) * 100}%`, height: "100%", background: `linear-gradient(90deg, ${KIND_META.wildcard.color}, color-mix(in oklab, ${KIND_META.wildcard.color} 60%, white))`, borderRadius: 6, transition: "width .25s" }} />
              </div>
              <div className="wp-mono" style={{ textAlign: "right", fontSize: 12 }}>{v}</div>
            </React.Fragment>
          );
        })}
      </div>
    </Card>
  );
}

function TRFixedResults({ results, mod, onRerun }) {
  return (
    <Card title="Resolved bindings"
      action={<Button size="sm" variant="ghost" icon="pi-refresh" onClick={onRerun}>Re-run</Button>}>
      <div className="wp-dim" style={{ fontSize: 11.5, marginBottom: 10 }}>
        Fixed values are deterministic — every run emits the same {mod.values.length} binding(s).
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", rowGap: 6, columnGap: 12, alignItems: "center" }}>
        {results.bindings.map((b) => (
          <React.Fragment key={b.var}>
            <span className="wp-mono" style={{ fontSize: 12.5, color: "var(--wp-accent-text)" }}>${b.var}</span>
            <span className="wp-mono" style={{ fontSize: 12.5 }}>{b.value}</span>
          </React.Fragment>
        ))}
      </div>
    </Card>
  );
}

function TRCombineResults({ results, mod, onRerun }) {
  const max = Math.max(...Object.values(results.counts));
  const sorted = Object.entries(results.counts).sort((a, b) => b[1] - a[1]).slice(0, 12);
  return (
    <>
      <Card title="Sample renderings"
        action={<Button size="sm" variant="ghost" icon="pi-refresh" onClick={onRerun}>Re-run</Button>}>
        <div className="wp-dim" style={{ fontSize: 11.5, marginBottom: 10 }}>
          Template <span className="wp-mono" style={{ color: "var(--wp-accent-text)" }}>{mod.template}</span> · resolves <span className="wp-mono">{mod.inputs.length}</span> upstream vars per run
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {results.examples.map((e, i) => (
            <div key={i} style={{ padding: "8px 10px", background: "var(--wp-bg-2)", border: "1px solid var(--wp-border)", borderRadius: 6 }}>
              <div className="wp-mono" style={{ fontSize: 12, color: "var(--wp-text)", marginBottom: 4 }}>{e.filled}</div>
              <div className="wp-mono wp-dim" style={{ fontSize: 11 }}>
                {Object.entries(e.ctx).map(([k, v]) => `$${k}=${v}`).join(" · ")}
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card title={`Distribution — ${results.samples} samples · ${Object.keys(results.counts).length} unique`}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 50px", rowGap: 7, columnGap: 10, alignItems: "center" }}>
          {sorted.map(([k, v]) => (
            <React.Fragment key={k}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, alignItems: "center", minWidth: 0 }}>
                <div className="wp-mono" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k}</div>
                <div style={{ height: 14, background: "var(--wp-bg-3)", borderRadius: 5 }}>
                  <div style={{ width: `${(v / max) * 100}%`, height: "100%", background: KIND_META.combine.color, borderRadius: 5 }} />
                </div>
              </div>
              <div className="wp-mono" style={{ textAlign: "right", fontSize: 12 }}>{v}</div>
            </React.Fragment>
          ))}
        </div>
        {Object.keys(results.counts).length > 12 && (
          <div className="wp-dim" style={{ fontSize: 11.5, marginTop: 10 }}>… {Object.keys(results.counts).length - 12} more distinct outputs</div>
        )}
      </Card>
    </>
  );
}

function TRConstraintResults({ results, onRerun }) {
  const { target, source, rows } = results;
  if (!target || !source) {
    return <Card title="Constraint preview"><div className="wp-dim">Constraint references a wildcard that no longer exists.</div></Card>;
  }
  const modeColor = (m) => ({
    allow: "var(--wp-text)", boost: "#34d399", reduce: "#fbbf24", exclude: "#f87171",
  }[m] || "var(--wp-text)");
  return (
    <Card title="Effective weights — before vs after"
      action={<Button size="sm" variant="ghost" icon="pi-refresh" onClick={onRerun}>Recompute</Button>}>
      <div className="wp-dim" style={{ fontSize: 11.5, marginBottom: 10 }}>
        Each column shows the resolved weights of <span className="wp-mono">{target.name}</span> conditioned on a value of <span className="wp-mono">{source.name}</span>.
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--wp-border)" }}>
              <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--wp-dim)", fontWeight: 500 }}>{target.name}</th>
              <th style={{ textAlign: "right", padding: "6px 8px", color: "var(--wp-dim)", fontWeight: 500 }}>w</th>
              {source.options.map((s) => (
                <th key={s.value} style={{ textAlign: "right", padding: "6px 8px", color: "var(--wp-dim)", fontWeight: 500, whiteSpace: "nowrap" }}>{s.value}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderBottom: "1px solid var(--wp-border-soft)" }}>
                <td className="wp-mono" style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{r.value}</td>
                <td className="wp-mono" style={{ padding: "6px 8px", textAlign: "right", color: "var(--wp-dim)" }}>{r.before}</td>
                {source.options.map((s) => {
                  const a = r.after[s.value];
                  return (
                    <td key={s.value} className="wp-mono" style={{ padding: "6px 8px", textAlign: "right", color: modeColor(a._mode), opacity: a._mode === "exclude" ? 0.55 : 1 }}>
                      {a.weight === 0 ? "—" : a.weight.toFixed(a.weight % 1 ? 2 : 0)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 12, fontSize: 11, color: "var(--wp-dim)" }}>
        <span><span style={{ color: "#34d399" }}>●</span> boost ×3</span>
        <span><span style={{ color: "var(--wp-text)" }}>●</span> allow</span>
        <span><span style={{ color: "#fbbf24" }}>●</span> reduce ×0.25</span>
        <span><span style={{ color: "#f87171" }}>●</span> exclude</span>
      </div>
    </Card>
  );
}

function TRDerivationResults({ results, mod, onRerun }) {
  const { before, after, trace } = results;
  const allKeys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  return (
    <>
      <Card title="Rule trace"
        action={<Button size="sm" variant="ghost" icon="pi-refresh" onClick={onRerun}>Re-run</Button>}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {trace.map((t, i) => {
            const rule = mod.rules[i];
            return (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "60px 1fr auto", gap: 10, padding: "8px 10px", background: "var(--wp-bg-2)", border: "1px solid var(--wp-border)", borderRadius: 6, alignItems: "center" }}>
                <span className="wp-mono wp-dim" style={{ fontSize: 11 }}>rule {String(i + 1).padStart(2, "0")}</span>
                <div className="wp-mono" style={{ fontSize: 12 }}>
                  {t.kind === "skip" ? <span className="wp-dim">no branch matched, no else</span> :
                   t.kind === "else" ? <><span style={{ color: "var(--wp-dim)" }}>else →</span> {t.action.kind} <span style={{ color: "var(--wp-accent-text)" }}>{t.action.target}</span> "{t.action.value}"</> :
                   <><span style={{ color: KIND_META.derivation.color }}>branch {t.branch + 1} →</span> {t.action.kind} <span style={{ color: "var(--wp-accent-text)" }}>{t.action.target}</span> "{t.action.value}"</>}
                </div>
                <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4,
                  background: t.kind === "skip" ? "var(--wp-bg-3)" : `color-mix(in oklab, ${KIND_META.derivation.color} 18%, transparent)`,
                  color: t.kind === "skip" ? "var(--wp-dim)" : KIND_META.derivation.color }}>
                  {t.kind === "skip" ? "skipped" : "fired"}
                </span>
              </div>
            );
          })}
        </div>
      </Card>
      <Card title="Context — before vs after">
        <div style={{ display: "grid", gridTemplateColumns: "160px 1fr 1fr", rowGap: 6, columnGap: 12, alignItems: "center", fontSize: 12.5 }}>
          <div className="wp-dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>Var</div>
          <div className="wp-dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>Before</div>
          <div className="wp-dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>After</div>
          {allKeys.map((k) => {
            const changed = before[k] !== after[k];
            return (
              <React.Fragment key={k}>
                <span className="wp-mono" style={{ color: "var(--wp-accent-text)", fontSize: 12 }}>${k}</span>
                <span className="wp-mono" style={{ fontSize: 12, color: "var(--wp-dim)" }}>{before[k] || <span style={{ opacity: 0.5 }}>(empty)</span>}</span>
                <span className="wp-mono" style={{ fontSize: 12, color: changed ? KIND_META.derivation.color : "var(--wp-text)" }}>
                  {after[k] || <span style={{ opacity: 0.5 }}>(empty)</span>}
                </span>
              </React.Fragment>
            );
          })}
        </div>
      </Card>
    </>
  );
}

function TRPipelineResults({ results, mod, onRerun, traceOpen, setTraceOpen }) {
  const fpEntries = Object.entries(results.finalCounts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...Object.values(results.finalCounts));
  const open = results.runs[traceOpen];
  return (
    <>
      <Card title={`Pipeline trace — sample ${traceOpen + 1} of ${results.runs.length}`}
        action={
          <div style={{ display: "flex", gap: 6 }}>
            <Button size="sm" variant="ghost" icon="pi-chevron-left" onClick={() => setTraceOpen((i) => Math.max(0, i - 1))} disabled={traceOpen <= 0}>Prev</Button>
            <Button size="sm" variant="ghost" icon="pi-chevron-right" onClick={() => setTraceOpen((i) => Math.min(results.runs.length - 1, i + 1))} disabled={traceOpen >= results.runs.length - 1}>Next</Button>
            <Button size="sm" variant="ghost" icon="pi-refresh" onClick={onRerun}>Re-run</Button>
          </div>
        }>
        {open && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {open.trace.map((t, i) => {
              const km = KIND_META[t.kind] || { color: "var(--wp-dim)", icon: "pi-circle" };
              return (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "32px 110px 1fr", gap: 10, padding: "6px 8px", borderRadius: 5, background: i % 2 ? "transparent" : "var(--wp-bg-2)", alignItems: "center" }}>
                  <span className="wp-mono wp-dim" style={{ fontSize: 11 }}>{String(i + 1).padStart(2, "0")}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: km.color, fontFamily: "var(--wp-font-mono)" }}>
                    <Icon name={km.icon} style={{ fontSize: 10 }} /> {t.kind}
                  </span>
                  <div className="wp-mono" style={{ fontSize: 12, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <span style={{ color: "var(--wp-text)" }}>{t.name}</span>
                    {t.note ? <span style={{ color: "var(--wp-dim)" }}> — {t.note}</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="Resolved context (final)">
        {open && Object.keys(open.ctx).length === 0 ? (
          <div className="wp-dim">No bindings produced.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", rowGap: 5, columnGap: 12, alignItems: "center", fontSize: 12.5 }}>
            {open && Object.entries(open.ctx).map(([k, v]) => (
              <React.Fragment key={k}>
                <span className="wp-mono" style={{ color: "var(--wp-accent-text)", fontSize: 12 }}>${k}</span>
                <span className="wp-mono" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
              </React.Fragment>
            ))}
          </div>
        )}
      </Card>

      <Card title={`Output distribution — ${results.samples} run(s) · ${fpEntries.length} unique`}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 50px", rowGap: 6, columnGap: 10, alignItems: "center" }}>
          {fpEntries.slice(0, 10).map(([k, v]) => (
            <React.Fragment key={k}>
              <div className="wp-mono" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--wp-text)" }}>
                {k || "(empty)"}
              </div>
              <div style={{ height: 12, background: "var(--wp-bg-3)", borderRadius: 4, gridColumn: "1 / -1", marginBottom: 2 }}>
                <div style={{ width: `${(v / max) * 100}%`, height: "100%", background: KIND_META.pipeline.color, borderRadius: 4 }} />
              </div>
            </React.Fragment>
          ))}
        </div>
        {fpEntries.length > 10 && (
          <div className="wp-dim" style={{ fontSize: 11.5, marginTop: 8 }}>… {fpEntries.length - 10} more</div>
        )}
      </Card>
    </>
  );
}

// ---------- Settings (drawer-like full page) ----------
function SettingsScreen({ tweaks, setTweak }) {
  return (
    <div className="wp-page" style={{ maxWidth: 720 }}>
      <PageHeader title="Settings" subtitle="Application preferences. Stored locally; sync with the ComfyUI extension on save." />

      <Card title="Appearance">
        <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 12, alignItems: "center" }}>
          <div className="wp-field__label">Accent</div>
          <div style={{ display: "flex", gap: 6 }}>
            {[
              { name: "violet", color: "#8b5cf6" },
              { name: "indigo", color: "#6366f1" },
              { name: "teal",   color: "#14b8a6" },
              { name: "rose",   color: "#f43f5e" },
              { name: "amber",  color: "#f59e0b" },
            ].map((p) => (
              <button key={p.name} onClick={() => setTweak("accent", p.name)} title={p.name}
                style={{ width: 28, height: 28, borderRadius: 6, border: tweaks.accent === p.name ? "2px solid #fff" : "1px solid var(--wp-border)", background: p.color, cursor: "pointer", padding: 0 }} />
            ))}
          </div>

          <div className="wp-field__label">Density</div>
          <div className="wp-hsplit" style={{ gap: 6 }}>
            {["compact", "comfortable"].map((d) => (
              <Button key={d} size="sm" variant={tweaks.density === d ? "outline" : "default"} onClick={() => setTweak("density", d)}>{d}</Button>
            ))}
          </div>

          <div className="wp-field__label">Sidebar</div>
          <div className="wp-hsplit" style={{ gap: 6 }}>
            {["expanded", "collapsed"].map((d) => (
              <Button key={d} size="sm" variant={tweaks.sidebar === d ? "outline" : "default"} onClick={() => setTweak("sidebar", d)}>{d}</Button>
            ))}
          </div>
        </div>
      </Card>

      <Card title="Engine">
        <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 12, alignItems: "center" }}>
          <div className="wp-field__label">Default sample size</div>
          <Input type="number" defaultValue={50} style={{ maxWidth: 140 }} />
          <div className="wp-field__label">Max nesting depth</div>
          <Input type="number" defaultValue={8} style={{ maxWidth: 140 }} />
          <div className="wp-field__label">Snapshot on insert</div>
          <Toggle on={true} onChange={() => {}} />
        </div>
      </Card>

      <Card title="About">
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 16px", fontSize: 12.5 }}>
          <span className="wp-dim">Version</span><span className="wp-mono">1.4.2-dev</span>
          <span className="wp-dim">Engine</span><span className="wp-mono">ComfyUI custom-node bundle</span>
          <span className="wp-dim">Database</span><span className="wp-mono">~/user/default/wildcard-pipeline.db (SQLite, WAL)</span>
          <span className="wp-dim">SPA mount</span><span className="wp-mono">/wp/</span>
        </div>
      </Card>
    </div>
  );
}

Object.assign(window, { CategoriesScreen, ImportExportScreen, TestRunnerScreen, SettingsScreen });
