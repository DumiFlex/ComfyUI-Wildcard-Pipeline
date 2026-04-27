/* global React, ReactDOM, WP_DATA, KIND_META, Icon, Button, Field, Input, Textarea, Select, TagInput, Chip, Card, TokenAutocomplete, RichTextInput, RichTextPreview, TokenPropsPopover, classNames */
const { useState, useMemo, useRef, useEffect } = React;

// ---------- Relative time helper ----------
function relTime(ts) {
  if (!ts) return "—";
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

// ---------- History panel ----------
function HistoryPanel({ history, onClose, onRestore, kindLabel }) {
  const [selected, setSelected] = useState(0);
  const snap = history[selected];
  return (
    <div className="wp-history-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wp-history-panel" role="dialog" aria-label="Version history">
        <div className="wp-history-panel__header">
          <div>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Version history</h3>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--wp-text-muted)" }}>
              Last {history.length} save{history.length === 1 ? "" : "s"} · oldest is overwritten on save
            </p>
          </div>
          <Button variant="ghost" icon="pi-times" onClick={onClose} aria-label="Close" />
        </div>
        <div className="wp-history-panel__body">
          <div className="wp-history-list">
            {history.map((h, i) => (
              <button
                key={i}
                type="button"
                className="wp-history-item"
                data-active={i === selected}
                onClick={() => setSelected(i)}
              >
                <div className="wp-history-item__top">
                  <span className="wp-history-item__label">{i === 0 ? "Previous save" : `${i + 1} saves ago`}</span>
                  <span className="wp-history-item__time">{relTime(h.savedAt)}</span>
                </div>
                <div className="wp-history-item__name">{h.name || "Untitled"}</div>
              </button>
            ))}
          </div>
          <div className="wp-history-preview">
            {snap ? (
              <>
                <div className="wp-history-preview__head">
                  <div>
                    <div style={{ fontSize: 11, color: "var(--wp-text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>Snapshot · {new Date(snap.savedAt).toLocaleString()}</div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{snap.name || "Untitled"}</div>
                  </div>
                  <Button variant="primary" icon="pi-refresh" onClick={() => onRestore(snap)}>Restore this version</Button>
                </div>
                <pre className="wp-history-preview__json">{JSON.stringify(stripMeta(snap), null, 2)}</pre>
              </>
            ) : (
              <div style={{ padding: 24, color: "var(--wp-text-muted)", fontSize: 13 }}>Select a snapshot to preview.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function stripMeta(snap) {
  const { id, savedAt, updatedAt, favorite, valid, history, ...rest } = snap;
  return rest;
}

// ---------- Shared editor frame ----------
function EditorFrame({ kind, isNew, onCancel, onSave, breadcrumbLabel, children, headerExtra, history, onRestore }) {
  const meta = KIND_META[kind];
  const [showHistory, setShowHistory] = useState(false);
  const hasHistory = !isNew && history && history.length > 0;
  return (
    <div className="wp-page" style={{ maxWidth: 980 }}>
      <button className="wp-breadcrumb" onClick={onCancel}>
        <Icon name="pi-chevron-left" style={{ fontSize: 11 }} />
        {breadcrumbLabel}
      </button>
      <div className="wp-page__header">
        <div className="wp-page__title-wrap">
          <h1 className="wp-page__title" style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <span style={{
              width: 28, height: 28, borderRadius: 8, display: "inline-grid", placeItems: "center",
              background: `color-mix(in oklab, ${meta.color} 18%, transparent)`,
              color: meta.color, fontSize: 13,
            }}><Icon name={meta.icon} /></span>
            {isNew ? `New ${meta.label}` : `Edit ${meta.label}`}
          </h1>
        </div>
        {headerExtra}
      </div>
      {children}
      <div className="wp-footer-bar">
        <div className="wp-footer-bar__inner">
          {hasHistory && (
            <Button icon="pi-history" onClick={() => setShowHistory(true)}>
              History
              <span style={{
                marginLeft: 4,
                background: "var(--wp-bg-3)",
                color: "var(--wp-text-muted)",
                fontSize: 10,
                fontWeight: 600,
                padding: "1px 6px",
                borderRadius: 999,
                lineHeight: 1.4,
              }}>{history.length}</span>
            </Button>
          )}
          <div style={{ flex: 1 }} />
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" icon="pi-check" onClick={onSave}>Save</Button>
        </div>
      </div>
      {showHistory && hasHistory && (
        <HistoryPanel
          history={history}
          kindLabel={meta.label}
          onClose={() => setShowHistory(false)}
          onRestore={(snap) => { onRestore(snap); setShowHistory(false); }}
        />
      )}
    </div>
  );
}

// ---------- Identity card (shared) ----------
function IdentityCard({ values, set, showDescription = true, varBindingHint }) {
  // Auto-fill varBinding from name when user hasn't customized it.
  const onNameChange = (e) => {
    const next = e.target.value;
    const auto = (values.name || "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_|_$/g, "");
    const isAuto = !values.varBinding || values.varBinding === auto;
    const patch = { name: next };
    if (isAuto && "varBinding" in values) {
      patch.varBinding = next.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_|_$/g, "");
    }
    set(patch);
  };
  return (
    <Card title="Identity">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Name">
          <Input value={values.name || ""} onChange={onNameChange} placeholder="e.g. Hair Color" />
        </Field>
        <Field label="Category">
          <Select
            value={values.category}
            onChange={(v) => set({ category: v })}
            allowClear
            placeholder="None"
            options={WP_DATA.categories.map((c) => ({ value: c.id, label: c.name, dot: c.color }))}
          />
        </Field>
        {"varBinding" in values && (
          <Field label="Variable name" hint={varBindingHint || "Reference this in templates as $name. Auto-derived from the name unless you customize it."} style={{ gridColumn: "1 / -1" }}>
            <div className="wp-input-group">
              <span className="wp-input-group__addon">$</span>
              <input
                className="wp-input wp-mono"
                value={values.varBinding || ""}
                onChange={(e) => set({ varBinding: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })}
                placeholder="hair_color"
              />
            </div>
          </Field>
        )}
        {showDescription && (
          <Field label="Description" className="wp-full" style={{ gridColumn: "1 / -1" }}>
            <Textarea value={values.description || ""} onChange={(e) => set({ description: e.target.value })} placeholder="What does this module do?" rows={3} />
          </Field>
        )}
        <Field label="Tags" style={{ gridColumn: "1 / -1" }}>
          <TagInput value={values.tags || []} onChange={(t) => set({ tags: t })} />
        </Field>
      </div>
    </Card>
  );
}

// ---------- Wildcard editor ----------
function WildcardEditor({ initial, isNew, onCancel, onSave }) {
  const [v, setV] = useState(() => {
    const base = {
      name: "", category: null, description: "", tags: [],
      varBinding: "",
      subCategories: [], options: [{ weight: 1, value: "", sub: "" }, { weight: 1, value: "", sub: "" }],
      ...initial,
    };
    if (!base.varBinding && base.name) {
      base.varBinding = base.name.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_|_$/g, "");
    }
    return base;
  });
  const set = (patch) => setV((x) => ({ ...x, ...patch }));
  const setOpt = (i, patch) => setV((x) => ({ ...x, options: x.options.map((o, j) => j === i ? { ...o, ...patch } : o) }));
  const addOpt = () => setV((x) => ({ ...x, options: [...x.options, { weight: 1, value: "", sub: "" }] }));
  const delOpt = (i) => setV((x) => ({ ...x, options: x.options.filter((_, j) => j !== i) }));

  // Suggestions for nested @-references = other wildcards (excluding self).
  const wcSuggestions = useMemo(() => (
    (WP_DATA.wildcards || [])
      .filter((w) => w.id !== initial?.id)
      .map((w) => ({ label: w.varBinding || w.name.toLowerCase().replace(/[^a-z0-9_]+/g, "_"), hint: w.name }))
      .sort((a, b) => a.label.localeCompare(b.label))
  ), [initial?.id]);

  const [subDraft, setSubDraft] = useState("");
  const addSub = () => {
    const s = subDraft.trim();
    if (s && !v.subCategories.includes(s)) set({ subCategories: [...v.subCategories, s] });
    setSubDraft("");
  };
  const delSub = (s) => set({ subCategories: v.subCategories.filter((x) => x !== s), options: v.options.map((o) => o.sub === s ? { ...o, sub: "" } : o) });

  const totalWeight = v.options.reduce((a, b) => a + (Number(b.weight) || 0), 0) || 1;

  return (
    <EditorFrame kind="wildcard" isNew={isNew} onCancel={onCancel} onSave={() => onSave(v)} breadcrumbLabel="Wildcards"
      history={initial?.history} onRestore={(snap) => setV((x) => ({ ...x, ...stripMeta(snap) }))}>
      <IdentityCard values={v} set={set} />

      <Card title="Sub-Categories" action={
        <span className="wp-dim" style={{ fontSize: 11.5 }}>Optional groupings inside this wildcard</span>
      }>
        <div style={{ display: "flex", gap: 8, marginBottom: v.subCategories.length ? 10 : 0 }}>
          <Input placeholder="e.g. warm tones" value={subDraft} onChange={(e) => setSubDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSub())} />
          <Button icon="pi-plus" onClick={addSub}>Add</Button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {v.subCategories.map((s) => <Chip key={s} variant="accent" onClose={() => delSub(s)}>{s}</Chip>)}
          {v.subCategories.length === 0 && <span className="wp-dim" style={{ fontSize: 12 }}>No sub-categories yet.</span>}
        </div>
      </Card>

      <Card title={`Options (${v.options.length})`} action={
        <Button size="sm" variant="primary" icon="pi-plus" onClick={addOpt}>Add option</Button>
      } padded={false}>
        <table className="wp-table">
          <thead>
            <tr>
              <th style={{ width: 80 }}>Weight</th>
              <th>Value</th>
              <th style={{ width: 200 }}>Sub-category</th>
              <th style={{ width: 120 }}>Probability</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {v.options.map((o, i) => {
              const p = ((Number(o.weight) || 0) / totalWeight) * 100;
              return (
                <tr key={i}>
                  <td><Input type="number" min={0} value={o.weight} onChange={(e) => setOpt(i, { weight: Number(e.target.value) })} /></td>
                  <td>
                    <RichTextInput
                      value={o.value}
                      onChange={(val) => setOpt(i, { value: val })}
                      refOptions={wcSuggestions}
                      triggers={["@"]}
                      placeholder="value (type @ for nested wildcards · {a|b|c} for inline choices)"
                      mono={false}
                    />
                  </td>
                  <td>
                    <Select
                      value={o.sub || ""}
                      onChange={(val) => setOpt(i, { sub: val || "" })}
                      placeholder="(none)"
                      allowClear
                      options={v.subCategories.map((s) => ({ value: s, label: s }))}
                    />
                  </td>
                  <td>
                    <div className="wp-hsplit" style={{ gap: 6 }}>
                      <div style={{ flex: 1, height: 6, background: "var(--wp-bg-3)", borderRadius: 999, overflow: "hidden" }}>
                        <div style={{ width: `${p}%`, height: "100%", background: "linear-gradient(90deg, var(--wp-accent-500), var(--wp-accent-400))" }} />
                      </div>
                      <span className="wp-mono wp-dim" style={{ fontSize: 11, width: 32, textAlign: "right" }}>{p.toFixed(0)}%</span>
                    </div>
                  </td>
                  <td><Button size="sm" variant="ghost" icon="pi-trash" className="wp-btn--danger" onClick={() => delOpt(i)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </EditorFrame>
  );
}

// ---------- Fixed Values editor ----------
function FixedValuesEditor({ initial, isNew, onCancel, onSave }) {
  const [v, setV] = useState(() => ({
    name: "", category: null, description: "", tags: [],
    values: [{ var: "", value: "" }, { var: "", value: "" }],
    ...initial,
  }));
  const set = (patch) => setV((x) => ({ ...x, ...patch }));
  const setVal = (i, patch) => setV((x) => ({ ...x, values: x.values.map((vv, j) => j === i ? { ...vv, ...patch } : vv) }));
  const add = () => setV((x) => ({ ...x, values: [...x.values, { var: "", value: "" }] }));
  const del = (i) => setV((x) => ({ ...x, values: x.values.filter((_, j) => j !== i) }));

  return (
    <EditorFrame kind="fixed" isNew={isNew} onCancel={onCancel} onSave={() => onSave(v)} breadcrumbLabel="Fixed Values"
      history={initial?.history} onRestore={(snap) => setV((x) => ({ ...x, ...stripMeta(snap) }))}>
      <IdentityCard values={v} set={set} />

      <Card title={`Values (${v.values.length})`} action={
        <Button size="sm" variant="primary" icon="pi-plus" onClick={add}>Add value</Button>
      } padded={false}>
        <table className="wp-table">
          <thead>
            <tr>
              <th style={{ width: 220 }}>Variable</th>
              <th>Value</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {v.values.map((vv, i) => (
              <tr key={i}>
                <td>
                  <div className="wp-input-group">
                    <span className="wp-input-group__addon">$</span>
                    <input className="wp-input" value={vv.var} onChange={(e) => setVal(i, { var: e.target.value.replace(/[^a-zA-Z0-9_]/g, "") })} placeholder="varname" />
                  </div>
                </td>
                <td><Input value={vv.value} onChange={(e) => setVal(i, { value: e.target.value })} placeholder="value" /></td>
                <td><Button size="sm" variant="ghost" icon="pi-trash" className="wp-btn--danger" onClick={() => del(i)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </EditorFrame>
  );
}

// ---------- Combine editor ----------
function CombineEditor({ initial, isNew, onCancel, onSave }) {
  const [v, setV] = useState(() => ({
    name: "", category: null, description: "", tags: [],
    template: "", inputs: [], output: "",
    ...initial,
  }));
  const set = (patch) => setV((x) => ({ ...x, ...patch }));
  const [tokenPopover, setTokenPopover] = useState(null); // {token, rect}

  // Auto-detect $var refs (skipping $$ escapes).
  const detected = Array.from(new Set(
    (v.template.match(/(?:^|[^$])\$([a-z_][a-z0-9_]*)/gi) || [])
      .map((m) => "$" + m.match(/\$([a-z_][a-z0-9_]*)/i)[1])
  ));

  // Suggestions = all known $-vars: wildcards (their varBinding), fixed-value names, combine outputs.
  const suggestions = useMemo(() => {
    const items = [];
    (WP_DATA.wildcards || []).forEach((w) => {
      const n = w.varBinding || w.name.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
      if (n) items.push({ label: n, hint: `wildcard · ${w.name}` });
    });
    (WP_DATA.fixedValues || []).forEach((fv) => (fv.values || []).forEach((row) => {
      const n = (row.var || row.name || "").replace(/^\$/, "");
      if (n) items.push({ label: n, hint: `fixed · ${fv.name}` });
    }));
    (WP_DATA.combines || []).forEach((cb) => {
      const n = (cb.output || "").replace(/^\$/, "");
      if (n) items.push({ label: n, hint: `combine · ${cb.name}` });
    });
    // De-dupe by label, prefer first occurrence.
    const seen = new Set();
    return items.filter((i) => seen.has(i.label) ? false : (seen.add(i.label), true)).sort((a, b) => a.label.localeCompare(b.label));
  }, []);

  return (
    <EditorFrame kind="combine" isNew={isNew} onCancel={onCancel} onSave={() => onSave(v)} breadcrumbLabel="Combines"
      history={initial?.history} onRestore={(snap) => setV((x) => ({ ...x, ...stripMeta(snap) }))}>
      <IdentityCard values={v} set={set} />

      <Card title="Template & Output">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 12 }}>
          <Field label="Template" hint="Reference variables with $name. Click any chip to set pick-count, separator, or repeat. Use $$ for a literal $. Use {a|b|c} for inline choices.">
            <RichTextInput
              value={v.template}
              onChange={(val) => set({ template: val })}
              options={suggestions}
              triggers={["$"]}
              multiline rows={3}
              placeholder="$name, a $age-year-old with $hair_color hair, wearing {a |the }$outfit"
              onTokenClick={(token, rect) => setTokenPopover({ token, rect })}
            />
          </Field>
          <Field label="Output variable" hint="Downstream modules read this name.">
            <div className="wp-input-group">
              <span className="wp-input-group__addon">$</span>
              <input className="wp-input" value={(v.output || "").replace(/^\$/, "")} onChange={(e) => set({ output: "$" + e.target.value.replace(/[^a-zA-Z0-9_]/g, "") })} placeholder="subject_phrase" />
            </div>
          </Field>
        </div>
        <div style={{ marginTop: 12 }}>
          <div className="wp-field__label" style={{ marginBottom: 6 }}>Detected inputs ({detected.length})</div>
          {detected.length === 0 ? <span className="wp-dim" style={{ fontSize: 12 }}>None — type a template above.</span> : (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {detected.map((d, i) => <Chip key={i} variant="accent" icon="pi-tag">{d}</Chip>)}
            </div>
          )}
        </div>
      </Card>

      <Card title="Preview">
        <div className="wp-snippet" style={{ lineHeight: 1.7 }}>
          <div><span className="wp-token-com">// Highlighted template syntax:</span></div>
          <div style={{ marginTop: 4, marginBottom: 8 }}>
            {v.template
              ? <RichTextPreview value={v.template} />
              : <span className="wp-dim">(empty template)</span>}
          </div>
          <div>
            <span className="wp-token-com">→ stored as </span>
            <span className="wp-token-var">{v.output || "$output"}</span>
          </div>
        </div>
      </Card>

      {tokenPopover && (
        <TokenPropsPopover
          token={tokenPopover.token}
          rect={tokenPopover.rect}
          value={v.template}
          onChange={(val) => set({ template: val })}
          onClose={() => setTokenPopover(null)}
          optionInfo={(() => {
            const info = suggestions.find((o) => o.label === tokenPopover.token.meta.name);
            if (!info) return { kind: "unknown", hint: "Not declared upstream — engine will treat as empty." };
            const kind = info.hint?.split(" · ")[0] || "variable";
            return { kind, hint: info.hint };
          })()}
        />
      )}
    </EditorFrame>
  );
}

// ---------- Derivation editor ----------
// A derivation is a list of INDEPENDENT rules. Every rule is evaluated against the resolved
// context. Each rule has:
//   - branches[]   ordered IF / ELIF clauses (first match wins for that single rule)
//   - else?        optional fallback action when no branch in that rule matched
function DerivationEditor({ initial, isNew, onCancel, onSave }) {
  const blankBranch = () => ({ condition: { kind: "contains", var: "", value: "" }, action: { kind: "append", target: "subject", value: "" } });
  const blankRule   = () => ({ branches: [blankBranch()], hasElse: false, else: { kind: "append", target: "subject", value: "" } });

  // Migrate older shapes (flat rules, condition/action pair) into the new branched structure
  // so existing seed data and history snapshots keep working.
  const migrate = (raw) => {
    if (!raw) return [blankRule()];
    if (Array.isArray(raw.rules) && raw.rules.length && raw.rules[0].branches) return raw.rules; // already new
    if (Array.isArray(raw.rules) && raw.rules.length) {
      // Old flat shape: every rule was independent IF/THEN — preserve that semantic.
      const rules = raw.rules.map((r) => ({ branches: [{ condition: r.condition || { kind: "always" }, action: r.action || blankBranch().action }], hasElse: false, else: blankBranch().action }));
      // If the old top-level had a single hasElse + else, attach to the last rule so it survives.
      if (raw.hasElse && raw.else && rules.length) { rules[rules.length - 1].hasElse = true; rules[rules.length - 1].else = raw.else; }
      return rules;
    }
    return [blankRule()];
  };

  const [v, setV] = useState(() => ({
    name: "", category: null, description: "", tags: [],
    ...initial,
    rules: migrate(initial),
  }));
  const set = (patch) => setV((x) => ({ ...x, ...patch }));

  // Mutators ------------------------------------------------------------------
  const setRule = (ri, fn) => set({ rules: v.rules.map((r, i) => i === ri ? fn(r) : r) });
  const addRule = () => set({ rules: [...v.rules, blankRule()] });
  const delRule = (ri) => set({ rules: v.rules.filter((_, i) => i !== ri) });
  const moveRule = (ri, dir) => {
    const j = ri + dir;
    if (j < 0 || j >= v.rules.length) return;
    const rules = [...v.rules];
    [rules[ri], rules[j]] = [rules[j], rules[ri]];
    set({ rules });
  };

  const setBranch = (ri, bi, patch) =>
    setRule(ri, (r) => ({ ...r, branches: r.branches.map((b, i) => i === bi ? { ...b, ...patch } : b) }));
  const setCond = (ri, bi, patch) =>
    setRule(ri, (r) => ({ ...r, branches: r.branches.map((b, i) => i === bi ? { ...b, condition: { ...b.condition, ...patch } } : b) }));
  const setAct = (ri, bi, patch) =>
    setRule(ri, (r) => ({ ...r, branches: r.branches.map((b, i) => i === bi ? { ...b, action: { ...b.action, ...patch } } : b) }));
  const addBranch = (ri) => setRule(ri, (r) => ({ ...r, branches: [...r.branches, blankBranch()] }));
  const delBranch = (ri, bi) => setRule(ri, (r) => ({ ...r, branches: r.branches.filter((_, i) => i !== bi) }));
  const setElse = (ri, patch) => setRule(ri, (r) => ({ ...r, else: { ...r.else, ...patch } }));
  const toggleElse = (ri) => setRule(ri, (r) => ({ ...r, hasElse: !r.hasElse }));

  // Options -------------------------------------------------------------------
  const opOptions = [
    { value: "contains", label: "contains" },
    { value: "equals",   label: "equals" },
    { value: "matches",  label: "regex matches" },
    { value: "absent",   label: "is absent" },
    { value: "always",   label: "always (no condition)" },
  ];
  const actOptions = [
    { value: "append",  label: "Append" },
    { value: "prepend", label: "Prepend" },
    { value: "replace", label: "Replace in" },
    { value: "remove",  label: "Remove from" },
  ];
  const targetOptions = [
    { value: "subject", label: "Subject clause" },
    { value: "scene",   label: "Scene clause" },
    { value: "prompt",  label: "Full prompt" },
    { value: "negative",label: "Negative prompt" },
  ];

  // Sub-component: a single condition/action pair (used for IF/ELIF branches and ELSE) ---
  const ConditionRow = ({ cond, onChange }) => (
    <div className="wp-rule__cond">
      {cond.kind !== "always" && (
        <div className="wp-input-group" style={{ minWidth: 160 }}>
          <span className="wp-input-group__addon">@</span>
          <input className="wp-input wp-mono" value={cond.var || ""} onChange={(e) => onChange({ var: e.target.value })} placeholder="weather" />
        </div>
      )}
      <div style={{ minWidth: 170 }}>
        <Select value={cond.kind} onChange={(val) => onChange({ kind: val })} options={opOptions} />
      </div>
      {cond.kind !== "absent" && cond.kind !== "always" && (
        <div style={{ flex: 1, minWidth: 160 }}>
          <Input value={cond.value || ""} onChange={(e) => onChange({ value: e.target.value })} placeholder="rain" />
        </div>
      )}
    </div>
  );

  const ActionRow = ({ action, onChange }) => (
    <div className="wp-rule__cond">
      <div style={{ minWidth: 130 }}>
        <Select value={action.kind} onChange={(val) => onChange({ kind: val })} options={actOptions} />
      </div>
      <div style={{ minWidth: 170 }}>
        <Select value={action.target} onChange={(val) => onChange({ target: val })} options={targetOptions} />
      </div>
      {action.kind !== "remove" && (
        <div style={{ flex: 1, minWidth: 200 }}>
          <Input value={action.value || ""} onChange={(e) => onChange({ value: e.target.value })} placeholder="wet clothes, soaked hair" />
        </div>
      )}
    </div>
  );

  return (
    <EditorFrame kind="derivation" isNew={isNew} onCancel={onCancel} onSave={() => onSave(v)} breadcrumbLabel="Derivations"
      history={initial?.history} onRestore={(snap) => setV((x) => ({ ...x, ...stripMeta(snap), rules: migrate(snap) }))}>
      <IdentityCard values={v} set={set} />

      <Card title={`Rules (${v.rules.length})`} action={
        <Button size="sm" variant="primary" icon="pi-plus" onClick={addRule}>Add rule</Button>
      }>
        <div className="wp-dim" style={{ fontSize: 11.5, marginBottom: 10 }}>
          Each rule runs independently. Inside a rule, branches evaluate top-to-bottom — the first matching IF/ELIF wins; the optional ELSE only fires when no branch matched.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {v.rules.map((rule, ri) => (
            <div key={ri} className="wp-rule wp-rule--group">
              <div className="wp-rule__head">
                <span className="wp-rule__num">RULE</span>
                <span className="wp-rule__index">#{ri + 1}</span>
                <div className="wp-spacer" />
                <Button size="sm" variant="ghost" icon="pi-arrow-up" disabled={ri === 0} onClick={() => moveRule(ri, -1)} title="Move up" />
                <Button size="sm" variant="ghost" icon="pi-arrow-down" disabled={ri === v.rules.length - 1} onClick={() => moveRule(ri, +1)} title="Move down" />
                <Button size="sm" variant="ghost" icon="pi-trash" className="wp-btn--danger" disabled={v.rules.length === 1} onClick={() => delRule(ri)} title="Delete rule" />
              </div>

              {/* Branches: IF (+ ELIFs) */}
              <div className="wp-rule__branches">
                {rule.branches.map((b, bi) => (
                  <div key={bi} className="wp-branch">
                    <div className="wp-branch__head">
                      <span className="wp-branch__tag" data-kind={bi === 0 ? "if" : "elif"}>{bi === 0 ? "IF" : "ELIF"}</span>
                      <div className="wp-spacer" />
                      {bi > 0 && (
                        <Button size="sm" variant="ghost" icon="pi-times" className="wp-btn--danger" onClick={() => delBranch(ri, bi)} title="Remove this elif" />
                      )}
                    </div>
                    <div className="wp-rule__row">
                      <span className="wp-rule__label">When</span>
                      <ConditionRow cond={b.condition} onChange={(p) => setCond(ri, bi, p)} />
                    </div>
                    <div className="wp-rule__row">
                      <span className="wp-rule__label">Then</span>
                      <ActionRow action={b.action} onChange={(p) => setAct(ri, bi, p)} />
                    </div>
                  </div>
                ))}

                {/* ELSE branch (per-rule, optional) */}
                {rule.hasElse && (
                  <div className="wp-branch wp-branch--else">
                    <div className="wp-branch__head">
                      <span className="wp-branch__tag" data-kind="else">ELSE</span>
                      <div className="wp-spacer" />
                      <Button size="sm" variant="ghost" icon="pi-times" className="wp-btn--danger" onClick={() => toggleElse(ri)} title="Remove else" />
                    </div>
                    <div className="wp-rule__row">
                      <span className="wp-rule__label">Then</span>
                      <ActionRow action={rule.else} onChange={(p) => setElse(ri, p)} />
                    </div>
                  </div>
                )}
              </div>

              {/* Add-elif / Add-else footer */}
              <div className="wp-rule__addbar">
                <Button size="sm" variant="ghost" icon="pi-plus" onClick={() => addBranch(ri)}>Add elif</Button>
                {!rule.hasElse && (
                  <Button size="sm" variant="ghost" icon="pi-plus" onClick={() => toggleElse(ri)}>Add else</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Preview">
        <div className="wp-snippet" style={{ lineHeight: 1.7 }}>
          {v.rules.length === 0 && <span className="wp-dim">No rules.</span>}
          {v.rules.map((rule, ri) => (
            <div key={ri} style={{ marginBottom: ri === v.rules.length - 1 ? 0 : 10 }}>
              <div className="wp-token-com" style={{ fontSize: 10.5, letterSpacing: ".05em", textTransform: "uppercase" }}># rule {ri + 1}</div>
              {rule.branches.map((b, bi) => (
                <div key={bi}>
                  <span className="wp-token-key">{bi === 0 ? "IF" : "ELIF"}</span>{" "}
                  {b.condition.kind === "always"
                    ? <span className="wp-token-com">always</span>
                    : <>@{b.condition.var || "var"} {b.condition.kind} {b.condition.kind !== "absent" && <span className="wp-token-str">"{b.condition.value}"</span>}</>}
                  <span className="wp-token-com"> · </span>
                  <span className="wp-token-key">THEN</span> {b.action.kind} {b.action.kind === "remove" ? "from" : "to"} {b.action.target} {b.action.kind !== "remove" && <span className="wp-token-str">"{b.action.value}"</span>}
                </div>
              ))}
              {rule.hasElse && (
                <div>
                  <span className="wp-token-key">ELSE</span> {rule.else.kind} {rule.else.kind === "remove" ? "from" : "to"} {rule.else.target} {rule.else.kind !== "remove" && <span className="wp-token-str">"{rule.else.value}"</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>
    </EditorFrame>
  );
}

// ---------- Constraint editor ----------
// Matrix cell shape: { mode: "allow"|"exclude"|"boost"|"reduce", factor: number }
// Factor only meaningful for boost/reduce. Click cycles mode; popover fine-tunes factor.
function ConstraintEditor({ initial, isNew, onCancel, onSave }) {
  const [v, setV] = useState(() => {
    const base = {
      name: "", category: null, description: "", tags: [],
      target: WP_DATA.wildcards[0]?.id, source: WP_DATA.wildcards[1]?.id,
      matrix: [], exceptions: [],
      ...initial,
    };
    return base;
  });
  const set = (patch) => setV((x) => ({ ...x, ...patch }));
  const [tunePos, setTunePos] = useState(null); // {ti, si, rect} | null
  const tuneRef = useRef(null);

  const t = WP_DATA.wildcards.find((w) => w.id === v.target);
  const s = WP_DATA.wildcards.find((w) => w.id === v.source);
  const tSubs = t?.subCategories || [];
  const sSubs = s?.subCategories || [];

  // Normalize legacy string cells → object form on read.
  const normalize = (raw) => {
    if (raw == null) return { mode: "allow", factor: 1 };
    if (typeof raw === "string") {
      if (raw === "boost")  return { mode: "boost",  factor: 2 };
      if (raw === "reduce") return { mode: "reduce", factor: 0.5 };
      return { mode: raw, factor: 1 };
    }
    return { mode: raw.mode || "allow", factor: typeof raw.factor === "number" ? raw.factor : (raw.mode === "boost" ? 2 : raw.mode === "reduce" ? 0.5 : 1) };
  };
  const cellAt = (ti, si) => normalize(v.matrix[ti]?.[si]);
  const writeCell = (ti, si, cell) => {
    const next = tSubs.map((_, i) => sSubs.map((__, j) => v.matrix[i]?.[j] || { mode: "allow", factor: 1 }));
    next[ti][si] = cell;
    set({ matrix: next });
  };
  const cycleCell = (ti, si) => {
    const cur = cellAt(ti, si);
    const nextMode = ({ allow: "exclude", exclude: "boost", boost: "reduce", reduce: "allow" })[cur.mode];
    const defaults = { allow: 1, exclude: 0, boost: 2, reduce: 0.5 };
    writeCell(ti, si, { mode: nextMode, factor: defaults[nextMode] });
  };
  const setCellFactor = (ti, si, factor) => writeCell(ti, si, { ...cellAt(ti, si), factor });

  const modeColor = { allow: null, exclude: "var(--wp-danger)", boost: "var(--wp-success)", reduce: "var(--wp-warn)" };
  const modeIcon  = { allow: "·", exclude: "×", boost: "↑", reduce: "↓" };
  const modeLabel = { allow: "Allow", exclude: "Exclude", boost: "Boost", reduce: "Reduce" };
  const fmtFactor = (f) => f >= 10 ? f.toFixed(0) : f.toFixed(2).replace(/\.?0+$/, "");

  // Exceptions ----------------------------------------------------------------
  const addException = () => set({ exceptions: [...(v.exceptions || []), { from: "", to: "", mode: "allow", factor: 1, note: "" }] });
  const setException = (i, patch) => set({ exceptions: v.exceptions.map((e, j) => j === i ? { ...e, ...patch } : e) });
  const delException = (i) => set({ exceptions: v.exceptions.filter((_, j) => j !== i) });

  // Close popover on outside click / scroll / resize
  React.useEffect(() => {
    if (!tunePos) return;
    const onDown = (e) => { if (!e.target.closest(".wp-tune-pop") && !e.target.closest(".wp-matrix-cell-wrap")) setTunePos(null); };
    const onScroll = () => setTunePos(null);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [tunePos]);

  return (
    <EditorFrame kind="constraint" isNew={isNew} onCancel={onCancel} onSave={() => onSave(v)} breadcrumbLabel="Constraints"
      history={initial?.history} onRestore={(snap) => setV((x) => ({ ...x, ...stripMeta(snap) }))}>
      <IdentityCard values={v} set={set} />

      <Card title="Wildcards" action={<span className="wp-dim" style={{ fontSize: 11.5 }}>Pick the two wildcards whose sub-categories form the matrix</span>}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 24px 1fr", gap: 12, alignItems: "end" }}>
          <Field label="Target wildcard" hint="Rows of the matrix">
            <Select value={v.target} onChange={(val) => set({ target: val, matrix: [] })}
              options={WP_DATA.wildcards.map((w) => ({ value: w.id, label: w.name }))} />
          </Field>
          <div style={{ paddingBottom: 8, color: "var(--wp-text-dim)", textAlign: "center" }}><Icon name="pi-times" /></div>
          <Field label="Source wildcard" hint="Columns of the matrix">
            <Select value={v.source} onChange={(val) => set({ source: val, matrix: [] })}
              options={WP_DATA.wildcards.map((w) => ({ value: w.id, label: w.name }))} />
          </Field>
        </div>
      </Card>

      <Card title="Rule matrix" action={
        <div className="wp-hsplit" style={{ gap: 10 }}>
          <span className="wp-dim" style={{ fontSize: 11.5 }}>Click cycles · ⓘ tunes factor</span>
          {Object.entries(modeIcon).map(([k, ic]) => (
            <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--wp-text-muted)" }}>
              <span style={{
                display: "inline-grid", placeItems: "center",
                width: 18, height: 18, borderRadius: 4,
                background: modeColor[k] ? `color-mix(in oklab, ${modeColor[k]} 16%, transparent)` : "var(--wp-bg-3)",
                color: modeColor[k] || "var(--wp-text-dim)",
                fontSize: 11, fontWeight: 600,
              }}>{ic}</span>
              {modeLabel[k]}
            </span>
          ))}
        </div>
      }>
        {(tSubs.length === 0 || sSubs.length === 0) ? (
          <div className="wp-empty" style={{ padding: "24px 12px" }}>
            <Icon name="pi-info-circle" />
            <div className="wp-dim">Both wildcards need sub-categories to define rules. Click cells when they do.</div>
          </div>
        ) : (
          <div style={{ overflowX: "auto", position: "relative" }}>
            <table className="wp-matrix">
              <thead>
                <tr>
                  <th className="wp-matrix__corner">
                    <span className="wp-mono" style={{ fontSize: 10.5 }}>{t?.name} ↓</span>
                    <span className="wp-mono" style={{ fontSize: 10.5 }}>{s?.name} →</span>
                  </th>
                  {sSubs.map((sub) => <th key={sub} className="wp-matrix__col-h">{sub}</th>)}
                </tr>
              </thead>
              <tbody>
                {tSubs.map((tSub, ti) => (
                  <tr key={tSub}>
                    <td className="wp-matrix__row-h">{tSub}</td>
                    {sSubs.map((sSub, si) => {
                      const cell = cellAt(ti, si);
                      const c = modeColor[cell.mode];
                      const tunable = cell.mode === "boost" || cell.mode === "reduce";
                      const isOpen = tunePos && tunePos.ti === ti && tunePos.si === si;
                      const openTune = (e) => {
                        const wrap = e.currentTarget.closest(".wp-matrix-cell-wrap");
                        const rect = wrap.getBoundingClientRect();
                        setTunePos(isOpen ? null : { ti, si, rect: { left: rect.left, top: rect.bottom, width: rect.width } });
                      };
                      return (
                        <td key={sSub}>
                          <div className="wp-matrix-cell-wrap">
                            <button type="button" title={`${tSub} × ${sSub} — ${modeLabel[cell.mode]}${tunable ? ` ×${fmtFactor(cell.factor)}` : ""} (click cycles)`}
                              className="wp-matrix-cell"
                              onClick={() => cycleCell(ti, si)}
                              data-mode={cell.mode}
                              style={{
                                background: c ? `color-mix(in oklab, ${c} 16%, transparent)` : "var(--wp-bg-3)",
                                color: c || "var(--wp-text-dim)",
                                borderColor: c ? `color-mix(in oklab, ${c} 35%, transparent)` : "var(--wp-border)",
                              }}>
                              <span className="wp-matrix-cell__icon">{modeIcon[cell.mode]}</span>
                              {tunable && <span className="wp-matrix-cell__factor">×{fmtFactor(cell.factor)}</span>}
                            </button>
                            {tunable && (
                              <button type="button" className="wp-matrix-cell__tune" title="Fine-tune factor"
                                onClick={(e) => { e.stopPropagation(); openTune(e); }}>
                                <Icon name="pi-sliders-h" />
                              </button>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Tune popover — rendered via portal so it escapes the matrix's overflow context */}
      {tunePos && (() => {
        const cell = cellAt(tunePos.ti, tunePos.si);
        if (cell.mode !== "boost" && cell.mode !== "reduce") return null;
        const c = modeColor[cell.mode];
        const POP_W = 260;
        const left = Math.min(window.innerWidth - POP_W - 12, Math.max(12, tunePos.rect.left + tunePos.rect.width / 2 - POP_W / 2));
        const top = Math.min(window.innerHeight - 200, tunePos.rect.top + 8);
        return ReactDOM.createPortal(
          <div className="wp-tune-pop" style={{ position: "fixed", left, top, width: POP_W }} onClick={(e) => e.stopPropagation()}>
            <div className="wp-tune-pop__head">
              <span className="wp-mono" style={{ fontSize: 11, color: c }}>{modeLabel[cell.mode]} factor</span>
              <span className="wp-mono" style={{ fontSize: 12, color: "var(--wp-text)" }}>×{fmtFactor(cell.factor)}</span>
            </div>
            <input
              type="range"
              min={cell.mode === "boost" ? 1 : 0}
              max={cell.mode === "boost" ? 10 : 1}
              step={0.05}
              value={cell.factor}
              onChange={(e) => setCellFactor(tunePos.ti, tunePos.si, Number(e.target.value))}
              className="wp-range"
            />
            <div className="wp-tune-pop__row">
              <Input type="number" step={0.05}
                     min={cell.mode === "boost" ? 1 : 0}
                     max={cell.mode === "boost" ? 100 : 1}
                     value={cell.factor}
                     onChange={(e) => setCellFactor(tunePos.ti, tunePos.si, Number(e.target.value) || 0)} />
              <div className="wp-tune-pop__presets">
                {(cell.mode === "boost" ? [1.5, 2, 3, 5] : [0.75, 0.5, 0.25, 0.1]).map((p) => (
                  <button key={p} type="button" className="wp-chip-btn" onClick={() => setCellFactor(tunePos.ti, tunePos.si, p)} data-active={Math.abs(cell.factor - p) < 0.001}>×{fmtFactor(p)}</button>
                ))}
              </div>
            </div>
          </div>,
          document.body
        );
      })()}

      <Card title={`Exceptions (${(v.exceptions || []).length})`} action={
        <Button size="sm" variant="primary" icon="pi-plus" onClick={addException}>Add exception</Button>
      } padded={false}>
        {(v.exceptions || []).length === 0 ? (
          <div className="wp-empty" style={{ padding: "24px 12px" }}>
            <Icon name="pi-info-circle" />
            <div className="wp-dim">Per-pair overrides for specific option values that the matrix doesn't cover.</div>
          </div>
        ) : (
          <table className="wp-table">
            <thead>
              <tr>
                <th>{t?.name} option</th>
                <th>{s?.name} option</th>
                <th style={{ width: 130 }}>Mode</th>
                <th style={{ width: 110 }}>Factor</th>
                <th>Note</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {(v.exceptions || []).map((ex, i) => {
                const tunable = ex.mode === "boost" || ex.mode === "reduce";
                return (
                  <tr key={i}>
                    <td>
                      <Select
                        value={ex.from}
                        onChange={(val) => setException(i, { from: val })}
                        placeholder="Pick value"
                        options={(t?.options || []).map((o) => ({ value: o.value, label: o.value }))}
                      />
                    </td>
                    <td>
                      <Select
                        value={ex.to}
                        onChange={(val) => setException(i, { to: val })}
                        placeholder="Pick value"
                        options={(s?.options || []).map((o) => ({ value: o.value, label: o.value }))}
                      />
                    </td>
                    <td>
                      <Select
                        value={ex.mode}
                        onChange={(val) => {
                          const defaults = { allow: 1, exclude: 0, boost: 2, reduce: 0.5 };
                          setException(i, { mode: val, factor: defaults[val] });
                        }}
                        options={Object.keys(modeLabel).map((k) => ({ value: k, label: modeLabel[k] }))}
                      />
                    </td>
                    <td>
                      {tunable ? (
                        <Input type="number" step={0.05}
                          min={ex.mode === "boost" ? 1 : 0}
                          max={ex.mode === "boost" ? 100 : 1}
                          value={typeof ex.factor === "number" ? ex.factor : (ex.mode === "boost" ? 2 : 0.5)}
                          onChange={(e) => setException(i, { factor: Number(e.target.value) || 0 })} />
                      ) : <span className="wp-dim wp-mono" style={{ fontSize: 11.5 }}>—</span>}
                    </td>
                    <td><Input value={ex.note} onChange={(e) => setException(i, { note: e.target.value })} placeholder="why" /></td>
                    <td><Button size="sm" variant="ghost" icon="pi-trash" className="wp-btn--danger" onClick={() => delException(i)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </EditorFrame>
  );
}

// ---------- Pipeline editor ----------
// Visual analog of the ComfyUI WP_Context node: vertical stack of module
// references, runs top-to-bottom. Each step references a module from the
// library by (kind, refId). Steps can be reordered (drag handle), toggled
// off without deletion, or removed entirely.
const PIPELINE_KINDS = ["wildcard", "fixed", "combine", "derivation", "constraint"];

function PipelineEditor({ initial, isNew, onCancel, onSave }) {
  const [v, setV] = useState(() => ({
    name: "", category: null, description: "", tags: [],
    steps: [],
    ...initial,
  }));
  const set = (patch) => setV((x) => ({ ...x, ...patch }));
  const setSteps = (fn) => setV((x) => ({ ...x, steps: typeof fn === "function" ? fn(x.steps) : fn }));

  const [pickerOpen, setPickerOpen] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);

  const onDragStart = (i) => (e) => {
    setDragIdx(i);
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", String(i)); } catch {}
  };
  const onDragOver = (i) => (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (overIdx !== i) setOverIdx(i);
  };
  const onDragLeave = () => setOverIdx(null);
  const onDrop = (i) => (e) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === i) { setDragIdx(null); setOverIdx(null); return; }
    setSteps((s) => {
      const next = [...s];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(i, 0, moved);
      return next;
    });
    setDragIdx(null); setOverIdx(null);
  };
  const onDragEnd = () => { setDragIdx(null); setOverIdx(null); };

  const addStep = (kind, refId) => {
    setSteps((s) => [...s, { kind, refId, enabled: true }]);
    setPickerOpen(false);
  };
  const removeStep = (i)   => setSteps((s) => s.filter((_, j) => j !== i));
  const toggleStep = (i)   => setSteps((s) => s.map((x, j) => j === i ? { ...x, enabled: !x.enabled } : x));
  const duplicateStep = (i) => setSteps((s) => { const n = [...s]; n.splice(i + 1, 0, { ...s[i] }); return n; });
  const editStep = (i, refId) => setSteps((s) => s.map((x, j) => j === i ? { ...x, refId } : x));

  return (
    <EditorFrame kind="pipeline" isNew={isNew} onCancel={onCancel} onSave={() => onSave(v)} breadcrumbLabel="Pipelines"
      history={initial?.history} onRestore={(snap) => setV((x) => ({ ...x, ...stripMeta(snap) }))}>
      <IdentityCard values={v} set={set} />

      <Card title={`Modules (${v.steps.length})`}
        action={<span className="wp-dim" style={{ fontSize: 11.5 }}>Resolve top to bottom — each appends to context</span>}>
        <div className="wp-pl-stack">
          {v.steps.length === 0 && (
            <div className="wp-pl-empty">
              <Icon name="pi-list" style={{ fontSize: 22, color: "var(--wp-text-dim)", marginBottom: 6 }} />
              <div style={{ fontSize: 13, fontWeight: 500 }}>No modules yet</div>
              <div className="wp-dim" style={{ fontSize: 12 }}>Add modules from your library; they’ll resolve in order.</div>
            </div>
          )}
          {v.steps.map((s, i) => (
            <PipelineStepRow
              key={i}
              index={i}
              step={s}
              isDragOver={overIdx === i}
              isDragging={dragIdx === i}
              onDragStart={onDragStart(i)}
              onDragOver={onDragOver(i)}
              onDragLeave={onDragLeave}
              onDrop={onDrop(i)}
              onDragEnd={onDragEnd}
              onRemove={() => removeStep(i)}
              onToggle={() => toggleStep(i)}
              onDuplicate={() => duplicateStep(i)}
              onChangeRef={(refId) => editStep(i, refId)}
            />
          ))}

          <button type="button" className="wp-pl-add" onClick={() => setPickerOpen(true)}>
            <Icon name="pi-plus" />
            <span>add module</span>
          </button>
        </div>
      </Card>

      {/* Resolution preview */}
      {v.steps.length > 0 && <PipelinePreview steps={v.steps} />}

      {pickerOpen && <PipelineModulePicker onPick={addStep} onClose={() => setPickerOpen(false)} />}
    </EditorFrame>
  );
}

// ---------- One step row ----------
function PipelineStepRow({ index, step, isDragOver, isDragging, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd, onRemove, onToggle, onDuplicate, onChangeRef }) {
  const meta = KIND_META[step.kind];
  const list = ({ wildcard: WP_DATA.wildcards, fixed: WP_DATA.fixedValues, combine: WP_DATA.combines, derivation: WP_DATA.derivations, constraint: WP_DATA.constraints })[step.kind] || [];
  const ref = list.find((x) => x.id === step.refId);
  const sub = (() => {
    if (!ref) return "(missing reference)";
    if (step.kind === "wildcard")   return "$" + (ref.varBinding || "");
    if (step.kind === "fixed")      return ref.values?.map((v) => "$" + v.var).slice(0, 3).join(", ") + (ref.values?.length > 3 ? `, +${ref.values.length - 3}` : "");
    if (step.kind === "combine")    return ref.output;
    if (step.kind === "constraint") {
      const t = WP_DATA.wildcards.find((x) => x.id === ref.target);
      const s = WP_DATA.wildcards.find((x) => x.id === ref.source);
      return `${t?.name || "?"} × ${s?.name || "?"}`;
    }
    if (step.kind === "derivation") {
      const ruleCount = (ref.rules || []).length;
      return `${ruleCount} rule${ruleCount === 1 ? "" : "s"}`;
    }
    return "";
  })();

  return (
    <div
      className="wp-pl-row"
      data-drag-over={isDragOver ? "" : null}
      data-disabled={!step.enabled ? "" : null}
      data-dragging={isDragging ? "" : null}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      style={{ "--step-color": meta.color }}
    >
      <div className="wp-pl-row__handle" title="Drag to reorder">
        <Icon name="pi-bars" style={{ fontSize: 11 }} />
      </div>
      <button type="button" className="wp-pl-row__toggle" onClick={onToggle} title={step.enabled ? "Disable step" : "Enable step"}>
        <Icon name={step.enabled ? "pi-eye" : "pi-eye-slash"} style={{ fontSize: 11 }} />
      </button>
      <div className="wp-pl-row__icon" title={meta.label}>
        <Icon name={meta.icon} />
      </div>
      <div className="wp-pl-row__main">
        <div className="wp-pl-row__top">
          <span className="wp-pl-row__kind">{meta.label}</span>
          <span className="wp-pl-row__index">{String(index + 1).padStart(2, "0")}</span>
        </div>
        <div className="wp-pl-row__name">
          <RefSelect kind={step.kind} value={step.refId} onChange={onChangeRef} />
        </div>
        <div className="wp-pl-row__sub">{sub}</div>
      </div>
      <div className="wp-pl-row__actions">
        <button type="button" className="wp-pl-row__act" onClick={onDuplicate} title="Duplicate">
          <Icon name="pi-clone" />
        </button>
        <button type="button" className="wp-pl-row__act wp-pl-row__act--danger" onClick={onRemove} title="Remove">
          <Icon name="pi-times" />
        </button>
      </div>
    </div>
  );
}

// ---------- Inline reference selector (transparent, opens dropdown) ----------
function RefSelect({ kind, value, onChange }) {
  const list = ({ wildcard: WP_DATA.wildcards, fixed: WP_DATA.fixedValues, combine: WP_DATA.combines, derivation: WP_DATA.derivations, constraint: WP_DATA.constraints })[kind] || [];
  return (
    <select className="wp-pl-row__refselect" value={value || ""} onChange={(e) => onChange(e.target.value)}>
      {!list.find((x) => x.id === value) && <option value={value || ""}>(missing)</option>}
      {list.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
    </select>
  );
}

// ---------- Module picker modal ----------
function PipelineModulePicker({ onPick, onClose }) {
  const [tab, setTab] = useState("wildcard");
  const [q, setQ] = useState("");
  const list = ({ wildcard: WP_DATA.wildcards, fixed: WP_DATA.fixedValues, combine: WP_DATA.combines, derivation: WP_DATA.derivations, constraint: WP_DATA.constraints })[tab] || [];
  const filtered = q.trim() ? list.filter((m) => m.name.toLowerCase().includes(q.toLowerCase()) || (m.tags || []).some((t) => t.toLowerCase().includes(q.toLowerCase()))) : list;

  return (
    <div className="wp-modal-backdrop" onClick={onClose}>
      <div className="wp-modal wp-modal--picker" onClick={(e) => e.stopPropagation()}>
        <div className="wp-modal__head">
          <Icon name="pi-plus" style={{ color: "var(--wp-accent-text)" }} />
          <span style={{ fontWeight: 600 }}>Add module to pipeline</span>
          <button type="button" className="wp-btn wp-btn--ghost wp-btn--sm wp-btn--icon" style={{ marginLeft: "auto" }} onClick={onClose}>
            <Icon name="pi-times" />
          </button>
        </div>
        <div className="wp-modal__body wp-pl-picker__body">
          <div className="wp-pl-picker__tabs">
            {PIPELINE_KINDS.map((k) => {
              const m = KIND_META[k];
              const count = ({ wildcard: WP_DATA.wildcards, fixed: WP_DATA.fixedValues, combine: WP_DATA.combines, derivation: WP_DATA.derivations, constraint: WP_DATA.constraints })[k].length;
              return (
                <button key={k} type="button" className="wp-pl-tab" data-active={tab === k ? "" : null} onClick={() => setTab(k)} style={{ "--tab-color": m.color }}>
                  <Icon name={m.icon} style={{ fontSize: 11 }} />
                  <span className="wp-pl-tab__label">{m.label}</span>
                  <span className="wp-pl-tab__count">{count}</span>
                </button>
              );
            })}
          </div>
          <div className="wp-input-group">
            <span className="wp-input-group__addon"><Icon name="pi-search" /></span>
            <input className="wp-input" placeholder="Search modules…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          </div>
          <div className="wp-pl-picker__list">
            {filtered.length === 0 ? (
              <div className="wp-dim" style={{ padding: 24, textAlign: "center", fontSize: 12 }}>No modules match.</div>
            ) : (
              filtered.map((m) => {
                const meta = KIND_META[tab];
                const cat = WP_DATA.categories.find((c) => c.id === m.category);
                return (
                  <button key={m.id} type="button" className="wp-pl-pickrow" onClick={() => onPick(tab, m.id)}>
                    <span className="wp-pl-pickrow__icon" style={{ background: `color-mix(in oklab, ${meta.color} 18%, transparent)`, color: meta.color }}>
                      <Icon name={meta.icon} />
                    </span>
                    <div className="wp-pl-pickrow__main">
                      <div className="wp-pl-pickrow__name">{m.name}</div>
                      <div className="wp-pl-pickrow__id">{m.id}</div>
                    </div>
                    {cat && <Chip color={cat.color}>{cat.name}</Chip>}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Pipeline preview (read-only context flow) ----------
function PipelinePreview({ steps }) {
  // Compute a synthetic resolved context that grows step-by-step.
  const flow = useMemo(() => {
    const ctx = {};
    return steps.filter((s) => s.enabled).map((s) => {
      const list = ({ wildcard: WP_DATA.wildcards, fixed: WP_DATA.fixedValues, combine: WP_DATA.combines, derivation: WP_DATA.derivations, constraint: WP_DATA.constraints })[s.kind] || [];
      const ref = list.find((x) => x.id === s.refId);
      const adds = [];
      if (s.kind === "wildcard" && ref) {
        const opt = ref.options[0];
        adds.push({ k: "$" + (ref.varBinding || "var"), v: opt?.value || "" });
      } else if (s.kind === "fixed" && ref) {
        (ref.values || []).slice(0, 3).forEach((vv) => adds.push({ k: "$" + vv.var, v: vv.value }));
      } else if (s.kind === "combine" && ref) {
        adds.push({ k: ref.output, v: "<combined>" });
      } else if (s.kind === "constraint") {
        adds.push({ k: "(matrix)", v: "biases applied" });
      } else if (s.kind === "derivation" && ref) {
        adds.push({ k: "(post)", v: `${(ref.rules || []).length} rules evaluated` });
      }
      adds.forEach((a) => { ctx[a.k] = a.v; });
      return { kind: s.kind, name: ref?.name || s.refId, adds, snapshot: { ...ctx } };
    });
  }, [steps]);

  return (
    <Card title="Resolution preview" action={<span className="wp-dim" style={{ fontSize: 11.5 }}>Synthetic example — picks first option per wildcard</span>}>
      <div className="wp-pl-flow">
        {flow.map((step, i) => {
          const m = KIND_META[step.kind];
          return (
            <div key={i} className="wp-pl-flow__step">
              <div className="wp-pl-flow__head" style={{ "--step-color": m.color }}>
                <span className="wp-pl-flow__idx">{String(i + 1).padStart(2, "0")}</span>
                <Icon name={m.icon} style={{ fontSize: 11, color: m.color }} />
                <span style={{ fontWeight: 500, fontSize: 12 }}>{step.name}</span>
              </div>
              {step.adds.length > 0 && (
                <div className="wp-pl-flow__adds">
                  {step.adds.map((a, j) => (
                    <div key={j} className="wp-pl-flow__binding">
                      <span style={{ color: "var(--wp-accent-text)", fontFamily: "var(--wp-font-mono)" }}>{a.k}</span>
                      <span className="wp-dim" style={{ fontFamily: "var(--wp-font-mono)" }}>=</span>
                      <span style={{ fontFamily: "var(--wp-font-mono)" }}>{a.v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

Object.assign(window, {
  WildcardEditor, FixedValuesEditor, CombineEditor, DerivationEditor, ConstraintEditor, PipelineEditor,
});
