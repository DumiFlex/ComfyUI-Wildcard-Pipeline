/* global React, WP_DATA, KIND_META, relTime, classNames,
   Icon, Button, Input, Select, Checkbox, Chip, Star, Card,
   buildWildcardGraph, getWildcardSyntax, RichTextPreview */
const { useState, useMemo } = React;

// ---------- Generic ModuleListView ----------
// Used by Wildcards, Fixed Values, Combines, Derivations, Constraints.
// Each kind passes its own column renderers + expand renderer.
function ModuleListView({
  kind,
  title,
  subtitle,
  items,
  setItems,
  onEdit,
  onCreate,
  columns,
  renderExpand,
  newLabel = "New",
  extraFilters = [],
}) {
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState(null);
  const [filterTags, setFilterTags] = useState([]); // string[] — AND-mode
  const [favOnly, setFavOnly] = useState(false);
  const [activeExtras, setActiveExtras] = useState([]); // keys of extraFilters that are on
  const [sort, setSort] = useState("updated_desc");
  const [expanded, setExpanded] = useState(() => new Set([items[0]?.id].filter(Boolean)));
  const [selected, setSelected] = useState(() => new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  const meta = KIND_META[kind];

  // All known tags across the list, with counts.
  const allTags = useMemo(() => {
    const counts = new Map();
    items.forEach((x) => (x.tags || []).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ tag: t, count: n }));
  }, [items]);

  const filtered = useMemo(() => {
    let out = items;
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter((x) => x.name.toLowerCase().includes(q) || (x.id || "").toLowerCase().includes(q) || (x.tags || []).some((t) => t.toLowerCase().includes(q)));
    }
    if (filterCat) out = out.filter((x) => x.category === filterCat);
    if (favOnly) out = out.filter((x) => x.favorite);
    if (filterTags.length > 0) out = out.filter((x) => filterTags.every((t) => (x.tags || []).includes(t)));
    if (activeExtras.length > 0) {
      const tests = activeExtras
        .map((k) => extraFilters.find((f) => f.key === k))
        .filter(Boolean);
      out = out.filter((x) => tests.every((f) => f.test(x)));
    }
    out = [...out].sort((a, b) => {
      switch (sort) {
        case "updated_asc":  return a.updatedAt - b.updatedAt;
        case "name_asc":     return a.name.localeCompare(b.name);
        case "name_desc":    return b.name.localeCompare(a.name);
        case "updated_desc":
        default:             return b.updatedAt - a.updatedAt;
      }
    });
    return out;
  }, [items, search, filterCat, favOnly, filterTags, activeExtras, extraFilters, sort]);

  // Reset to page 1 whenever filters change.
  React.useEffect(() => { setPage(1); }, [search, filterCat, favOnly, filterTags, activeExtras, sort, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const paged = filtered.slice(pageStart, pageStart + pageSize);

  const activeFilterCount = (filterCat ? 1 : 0) + (favOnly ? 1 : 0) + filterTags.length + activeExtras.length;
  const clearFilters = () => { setFilterCat(null); setFavOnly(false); setFilterTags([]); setActiveExtras([]); };

  const toggleExpand = (id) => setExpanded((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const toggleSel = (id) => setSelected((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const allSel = paged.length > 0 && paged.every((x) => selected.has(x.id));
  const someSel = !allSel && paged.some((x) => selected.has(x.id));
  const toggleAll = () => setSelected(allSel ? new Set() : new Set(paged.map((x) => x.id)));

  const setFav = (id, on) => setItems(items.map((x) => x.id === id ? { ...x, favorite: on } : x));
  const remove = (ids) => {
    setItems(items.filter((x) => !ids.includes(x.id)));
    setSelected(new Set());
  };
  const duplicate = (id) => {
    const src = items.find((x) => x.id === id);
    if (!src) return;
    const clone = { ...src, id: meta.id_prefix + Math.random().toString(36).slice(2, 8), name: src.name + " (copy)", updatedAt: Date.now(), favorite: false };
    setItems([clone, ...items]);
  };

  return (
    <div className="wp-page">
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={<Button variant="primary" icon="pi-plus" onClick={onCreate}>{newLabel}</Button>}
      />

      {/* Toolbar */}
      <div className="wp-toolbar">
        <div className="wp-toolbar__search">
          <div className="wp-input-group">
            <span className="wp-input-group__addon"><Icon name="pi-search" /></span>
            <input className="wp-input" placeholder="Search by name, id, tag…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <Button variant={filtersOpen ? "outline" : "default"} icon="pi-filter" onClick={() => setFiltersOpen((o) => !o)}>
          Filters {activeFilterCount > 0 ? <span className="wp-chip" style={{ padding: "0 6px", marginLeft: 2 }}>{activeFilterCount}</span> : null}
        </Button>
        <div style={{ width: 160 }}>
          <Select
            value={sort}
            onChange={(v) => setSort(v)}
            options={[
              { value: "updated_desc", label: "Updated — newest" },
              { value: "updated_asc",  label: "Updated — oldest" },
              { value: "name_asc",     label: "Name A → Z" },
              { value: "name_desc",    label: "Name Z → A" },
            ]}
          />
        </div>
        <span className="wp-toolbar__count">{filtered.length} / {items.length} items</span>
      </div>

      {/* Filters panel */}
      {filtersOpen && (
        <div className="wp-card" style={{ padding: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Category">
              <Select
                value={filterCat}
                onChange={setFilterCat}
                allowClear
                placeholder="Any category"
                options={WP_DATA.categories.map((c) => ({ value: c.id, label: c.name, dot: c.color }))}
              />
            </Field>
            <Field label="Favorites">
              <button type="button" className="wp-input" style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-start", cursor: "pointer" }} onClick={() => setFavOnly((f) => !f)}>
                <Checkbox checked={favOnly} onChange={setFavOnly} />
                <span>Favorites only</span>
              </button>
            </Field>
            <Field label={`Tags${filterTags.length ? ` (${filterTags.length})` : ""}`} hint="Click to toggle. Items must match all selected tags." style={{ gridColumn: "1 / -1" }}>
              {allTags.length === 0 ? (
                <span className="wp-dim" style={{ fontSize: 12 }}>No tags in this collection.</span>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {allTags.map(({ tag, count }) => {
                    const active = filterTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        className="wp-chip"
                        data-active={active ? "" : null}
                        onClick={() => setFilterTags((ts) => active ? ts.filter((t) => t !== tag) : [...ts, tag])}
                        style={{
                          cursor: "pointer",
                          background: active ? "color-mix(in oklab, var(--wp-accent-500) 22%, transparent)" : undefined,
                          borderColor: active ? "color-mix(in oklab, var(--wp-accent-500) 45%, transparent)" : undefined,
                          color: active ? "var(--wp-accent-text)" : undefined,
                        }}
                      >
                        {tag}
                        <span className="wp-dim" style={{ marginLeft: 4, fontSize: 10.5 }}>{count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </Field>
            {extraFilters.length > 0 && (
              <Field label="Syntax" hint="Filter by reference structure across the library." style={{ gridColumn: "1 / -1" }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {extraFilters.map((f) => {
                    const active = activeExtras.includes(f.key);
                    const count = items.filter((x) => f.test(x)).length;
                    return (
                      <button
                        key={f.key}
                        type="button"
                        className="wp-chip"
                        data-active={active ? "" : null}
                        onClick={() => setActiveExtras((xs) => active ? xs.filter((k) => k !== f.key) : [...xs, f.key])}
                        style={{
                          cursor: "pointer",
                          background: active ? "color-mix(in oklab, var(--wp-accent-500) 22%, transparent)" : undefined,
                          borderColor: active ? "color-mix(in oklab, var(--wp-accent-500) 45%, transparent)" : undefined,
                          color: active ? "var(--wp-accent-text)" : undefined,
                        }}
                      >
                        {f.label}
                        <span className="wp-dim" style={{ marginLeft: 4, fontSize: 10.5 }}>{count}</span>
                      </button>
                    );
                  })}
                </div>
              </Field>
            )}
          </div>
          {activeFilterCount > 0 && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
              <Button size="sm" variant="ghost" icon="pi-times" onClick={clearFilters}>Clear filters</Button>
            </div>
          )}
        </div>
      )}

      {/* Selection bar */}
      {selected.size > 0 && (
        <div className="wp-card" style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12.5 }}>{selected.size} selected</span>
          <div className="wp-spacer" />
          <Button size="sm" variant="ghost" icon="pi-tag">Set category</Button>
          <Button size="sm" variant="ghost" icon="pi-clone">Duplicate</Button>
          <Button size="sm" variant="danger" icon="pi-trash" onClick={() => remove([...selected])}>Delete</Button>
        </div>
      )}

      {/* Table */}
      <div className="wp-table-wrap">
        <table className="wp-table">
          <thead>
            <tr>
              <th style={{ width: 32, paddingRight: 0 }}>
                <Checkbox checked={allSel} indeterminate={someSel} onChange={toggleAll} />
              </th>
              <th style={{ width: 28, padding: 0 }} />
              <th style={{ width: 28, padding: 0 }} />
              <th className="wp-sortable">Name</th>
              {columns.map((c) => (
                <th key={c.key} style={{ width: c.width }}>{c.label}</th>
              ))}
              <th>Tags</th>
              <th className="wp-sortable" style={{ width: 90 }}>Updated</th>
              <th style={{ width: 110, textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6 + columns.length}>
                <div className="wp-empty">
                  <div className="wp-empty__icon"><Icon name={meta.icon} /></div>
                  <div style={{ color: "var(--wp-text)", fontWeight: 600 }}>No {meta.label.toLowerCase()}s match</div>
                  <div className="wp-dim">Try clearing filters, or create a new one.</div>
                  <Button variant="primary" icon="pi-plus" onClick={onCreate} style={{ marginTop: 6 }}>{newLabel}</Button>
                </div>
              </td></tr>
            )}
            {paged.map((row) => {
              const cat = WP_DATA.categories.find((c) => c.id === row.category);
              const isExpanded = expanded.has(row.id);
              return (
                <React.Fragment key={row.id}>
                  <tr data-expanded={isExpanded} onClick={() => toggleExpand(row.id)} style={{ cursor: "pointer" }}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selected.has(row.id)} onChange={() => toggleSel(row.id)} />
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button className="wp-btn wp-btn--ghost wp-btn--icon wp-btn--sm" onClick={() => toggleExpand(row.id)}>
                        <Icon name={isExpanded ? "pi-chevron-down" : "pi-chevron-right"} style={{ fontSize: 11 }} />
                      </button>
                    </td>
                    <td>
                      <Star on={row.favorite} onChange={(on) => setFav(row.id, on)} />
                    </td>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontWeight: 500 }}>{row.name}</span>
                        <span className="wp-id">{row.id}</span>
                      </div>
                    </td>
                    {columns.map((c) => <td key={c.key}>{c.render ? c.render(row) : row[c.key]}</td>)}
                    <td>
                      {(row.tags || []).length === 0 ? <span className="wp-dim">—</span> : (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {(row.tags || []).slice(0, 3).map((t) => <Chip key={t}>{t}</Chip>)}
                          {(row.tags || []).length > 3 && <Chip>+{row.tags.length - 3}</Chip>}
                        </div>
                      )}
                    </td>
                    <td className="wp-dim" style={{ fontSize: 11.5 }}>{relTime(row.updatedAt)}</td>
                    <td onClick={(e) => e.stopPropagation()} style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 2, justifyContent: "flex-end" }}>
                        <Button size="sm" variant="ghost" icon="pi-pencil" onClick={() => onEdit(row.id)} title="Edit" />
                        <Button size="sm" variant="ghost" icon="pi-clone" onClick={() => duplicate(row.id)} title="Duplicate" />
                        <Button size="sm" variant="ghost" icon="pi-trash" onClick={() => remove([row.id])} title="Delete" />
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={6 + columns.length} style={{ padding: 0 }}>
                        <div className="wp-row-expand">{renderExpand(row, cat)}</div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {filtered.length > 0 && (
        <div className="wp-pagination">
          <span className="wp-dim" style={{ fontSize: 12 }}>
            {pageStart + 1}–{Math.min(pageStart + pageSize, filtered.length)} of {filtered.length}
          </span>
          <div className="wp-spacer" />
          <span className="wp-dim" style={{ fontSize: 11.5 }}>Per page</span>
          <div style={{ width: 92 }}>
            <Select
              value={pageSize}
              onChange={(v) => setPageSize(Number(v))}
              options={[10, 15, 25, 50].map((n) => ({ value: n, label: String(n) }))}
            />
          </div>
          <div className="wp-pager">
            <Button size="sm" variant="ghost" icon="pi-angle-double-left" disabled={safePage === 1} onClick={() => setPage(1)} title="First" />
            <Button size="sm" variant="ghost" icon="pi-angle-left" disabled={safePage === 1} onClick={() => setPage(safePage - 1)} title="Previous" />
            <span className="wp-pager__label">Page {safePage} / {totalPages}</span>
            <Button size="sm" variant="ghost" icon="pi-angle-right" disabled={safePage === totalPages} onClick={() => setPage(safePage + 1)} title="Next" />
            <Button size="sm" variant="ghost" icon="pi-angle-double-right" disabled={safePage === totalPages} onClick={() => setPage(totalPages)} title="Last" />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Wildcards screen ----------
function WildcardsScreen({ onEdit, onCreate, items, setItems }) {
  const graph = useMemo(() => buildWildcardGraph(items), [items]);
  return (
    <ModuleListView
      kind="wildcard"
      title="Wildcards"
      subtitle="Wildcard modules pick one weighted option per resolution. Use $variable in prompts."
      items={items}
      setItems={setItems}
      onEdit={onEdit}
      onCreate={onCreate}
      newLabel="New Wildcard"
      extraFilters={[
        { key: "has_nested",   label: "Uses nested refs",   test: (r) => (graph.fwd.get(r.id)?.size || 0) > 0 },
        { key: "is_referenced",label: "Referenced by others", test: (r) => (graph.rev.get(r.varBinding)?.size || 0) > 0 },
        { key: "has_inline",   label: "Has inline {a|b|c}", test: (r) => getWildcardSyntax(r).hasInline },
      ]}
      columns={[
        { key: "category", label: "Category", width: 130, render: (r) => {
          const c = WP_DATA.categories.find((x) => x.id === r.category);
          return c ? <Chip color={c.color}>{c.name}</Chip> : <span className="wp-dim">—</span>;
        } },
        { key: "items", label: "Items", width: 60, render: (r) => <span className="wp-mono">{r.options.length}</span> },
        { key: "syntax", label: "Syntax", width: 84, render: (r) => {
          const sx = getWildcardSyntax(r);
          const refsOut = graph.fwd.get(r.id)?.size || 0;
          const refsIn  = graph.rev.get(r.varBinding)?.size || 0;
          if (!sx.hasNested && !sx.hasInline && !refsIn) {
            return <span className="wp-dim" style={{ fontSize: 11 }}>—</span>;
          }
          return (
            <div className="wp-syntax-cell" onClick={(e) => e.stopPropagation()}>
              {sx.hasNested && (
                <span className="wp-syntax-pill wp-syntax-pill--ref"
                      title={`Nests ${refsOut} other wildcard${refsOut === 1 ? "" : "s"}`}>
                  <Icon name="pi-arrow-right" /> {refsOut}
                </span>
              )}
              {refsIn > 0 && (
                <span className="wp-syntax-pill wp-syntax-pill--in"
                      title={`Referenced by ${refsIn} other wildcard${refsIn === 1 ? "" : "s"}`}>
                  <Icon name="pi-arrow-left" /> {refsIn}
                </span>
              )}
              {sx.hasInline && (
                <span className="wp-syntax-pill wp-syntax-pill--dp"
                      title="Contains inline {a|b|c} alternatives">
                  {"{ }"}
                </span>
              )}
            </div>
          );
        } },
        { key: "valid", label: "Valid", width: 60, render: (r) => r.valid
          ? <Icon name="pi-check-circle" style={{ color: "var(--wp-success)" }} />
          : <Icon name="pi-exclamation-triangle" style={{ color: "var(--wp-warn)" }} title="Empty option present" />
        },
      ]}
      renderExpand={(row) => {
        const totalWeight = row.options.reduce((a, b) => a + b.weight, 0);
        const refsOut = [...(graph.fwd.get(row.id) || [])];
        const refsInIds = [...(graph.rev.get(row.varBinding) || [])];
        return (
          <div>
            <div className="wp-row-expand__title">Top options for <span style={{ color: "var(--wp-accent-text)" }}>{row.name.toUpperCase()}</span></div>
            <div style={{ display: "grid", gridTemplateColumns: "30px 1fr 120px", gap: "4px 12px", maxWidth: 760, fontSize: 12.5, alignItems: "center" }}>
              {row.options.slice(0, 4).map((opt, i) => (
                <React.Fragment key={i}>
                  <span className="wp-mono wp-dim">{opt.weight}×</span>
                  <span className="wp-mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {opt.value
                      ? <RichTextPreview value={opt.value} />
                      : <span className="wp-dim">(empty)</span>}
                  </span>
                  <div style={{ background: "var(--wp-bg-3)", height: 6, borderRadius: 999, overflow: "hidden" }}>
                    <div style={{ width: `${(opt.weight / totalWeight) * 100}%`, height: "100%", background: "linear-gradient(90deg, var(--wp-accent-500), var(--wp-accent-400))" }} />
                  </div>
                </React.Fragment>
              ))}
            </div>
            {row.options.length > 4 && <div className="wp-dim" style={{ marginTop: 8, fontSize: 11.5 }}>… and {row.options.length - 4} more</div>}
            {(refsOut.length > 0 || refsInIds.length > 0) && (
              <div className="wp-syntax-graph">
                {refsOut.length > 0 && (
                  <div className="wp-syntax-graph__row">
                    <Icon name="pi-arrow-right" />
                    <span className="wp-dim">Nests:</span>
                    {refsOut.map((v) => {
                      const t = items.find((w) => w.varBinding === v);
                      return t
                        ? <button key={v} className="wp-syntax-link" onClick={(e) => { e.stopPropagation(); onEdit(t.id); }}>{t.name}</button>
                        : <span key={v} className="wp-syntax-link wp-syntax-link--missing" title="No wildcard found for this @ref">@{v}</span>;
                    })}
                  </div>
                )}
                {refsInIds.length > 0 && (
                  <div className="wp-syntax-graph__row">
                    <Icon name="pi-arrow-left" />
                    <span className="wp-dim">Referenced by:</span>
                    {refsInIds.map((id) => {
                      const t = items.find((w) => w.id === id);
                      return t
                        ? <button key={id} className="wp-syntax-link" onClick={(e) => { e.stopPropagation(); onEdit(t.id); }}>{t.name}</button>
                        : null;
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      }}
    />
  );
}

// ---------- Fixed Values screen ----------
function FixedValuesScreen({ onEdit, onCreate, items, setItems }) {
  return (
    <ModuleListView
      kind="fixed"
      title="Fixed Values"
      subtitle="Fixed-value modules emit one or more named string variables, set explicitly."
      items={items}
      setItems={setItems}
      onEdit={onEdit}
      onCreate={onCreate}
      newLabel="New Fixed Values"
      columns={[
        { key: "category", label: "Category", width: 130, render: (r) => {
          const c = WP_DATA.categories.find((x) => x.id === r.category);
          return c ? <Chip color={c.color}>{c.name}</Chip> : <span className="wp-dim">—</span>;
        } },
        { key: "values", label: "Values", width: 60, render: (r) => <span className="wp-mono">{r.values.length}</span> },
      ]}
      renderExpand={(row) => (
        <div>
          <div className="wp-row-expand__title">First values for <span style={{ color: "var(--wp-accent-text)" }}>{row.name.toUpperCase()}</span></div>
          <div className="wp-snippet" style={{ maxWidth: 540 }}>
            {row.values.slice(0, 4).map((v, i) => (
              <div key={i}>
                <span className="wp-token-var">${v.var}</span>
                <span className="wp-token-com">  =  </span>
                <span className="wp-token-str">"{v.value}"</span>
              </div>
            ))}
          </div>
        </div>
      )}
    />
  );
}

// ---------- Combines screen ----------
function CombinesScreen({ onEdit, onCreate, items, setItems }) {
  return (
    <ModuleListView
      kind="combine"
      title="Combines"
      subtitle="Combine modules merge upstream resolved values via a template, storing into a new variable for downstream."
      items={items}
      setItems={setItems}
      onEdit={onEdit}
      onCreate={onCreate}
      newLabel="New Combine"
      columns={[
        { key: "category", label: "Category", width: 130, render: (r) => {
          const c = WP_DATA.categories.find((x) => x.id === r.category);
          return c ? <Chip color={c.color}>{c.name}</Chip> : <span className="wp-dim">—</span>;
        } },
        { key: "output", label: "Output", width: 140, render: (r) => <span className="wp-mono" style={{ color: "var(--wp-accent-text)" }}>{r.output}</span> },
        { key: "inputs", label: "Inputs", width: 60, render: (r) => <span className="wp-mono">{r.inputs.length}</span> },
      ]}
      renderExpand={(row) => (
        <div>
          <div className="wp-row-expand__title">Template</div>
          <div className="wp-snippet" style={{ maxWidth: 720 }}>
            {row.template.split(/(\{[^}]+\}|\$[a-z_][a-z0-9_]*)/i).map((part, i) => {
              if (/^\{[^}]+\}$/.test(part)) return <span key={i} className="wp-token-key">{part}</span>;
              if (/^\$[a-z_]/i.test(part))    return <span key={i} className="wp-token-var">{part}</span>;
              return <span key={i}>{part}</span>;
            })}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            <span className="wp-dim" style={{ fontSize: 11.5, marginRight: 4 }}>Reads:</span>
            {row.inputs.map((v, i) => <Chip key={i} variant="accent" icon={v.startsWith("@") ? "pi-th-large" : "pi-tag"}>{v}</Chip>)}
          </div>
        </div>
      )}
    />
  );
}

// ---------- Derivations screen ----------
function DerivationsScreen({ onEdit, onCreate, items, setItems }) {
  return (
    <ModuleListView
      kind="derivation"
      title="Derivations"
      subtitle="Derivations mutate the resolved context post-resolution — append, replace, or remove tokens conditionally."
      items={items}
      setItems={setItems}
      onEdit={onEdit}
      onCreate={onCreate}
      newLabel="New Derivation"
      columns={[
        { key: "category", label: "Category", width: 130, render: (r) => {
          const c = WP_DATA.categories.find((x) => x.id === r.category);
          return c ? <Chip color={c.color}>{c.name}</Chip> : <span className="wp-dim">—</span>;
        } },
      ]}
      renderExpand={(row) => {
        const verb = (k) => ({ append: "append to", prepend: "prepend to", replace: "replace in", remove: "remove from" }[k] || k);
        const rules = row.rules || [];
        const fmtCond = (c) => c?.kind === "always"
          ? <em className="wp-dim">always</em>
          : <>@{c?.var || "?"} {c?.kind} {c?.kind !== "absent" && <span className="wp-token-str">"{c?.value}"</span>}</>;
        const fmtAct = (a) => <>{verb(a?.kind)} {a?.target} {a?.kind !== "remove" && <span className="wp-token-str">"{a?.value}"</span>}</>;
        return (
          <div>
            <div className="wp-row-expand__title">Rules ({rules.length})</div>
            <div className="wp-snippet" style={{ maxWidth: 720, lineHeight: 1.7 }}>
              {rules.length === 0 && <span className="wp-dim">No rules defined.</span>}
              {rules.map((rule, ri) => (
                <div key={ri} style={{ marginBottom: ri === rules.length - 1 ? 0 : 8 }}>
                  <div className="wp-token-com" style={{ fontSize: 10.5, letterSpacing: ".05em", textTransform: "uppercase" }}># rule {ri + 1}</div>
                  {(rule.branches || []).map((b, bi) => (
                    <div key={bi}>
                      <span className="wp-token-key">{bi === 0 ? "IF" : "ELIF"}</span>{" "}
                      {fmtCond(b.condition)}
                      <span className="wp-token-com"> · </span>
                      <span className="wp-token-key">THEN</span> {fmtAct(b.action)}
                    </div>
                  ))}
                  {rule.hasElse && rule.else && (
                    <div>
                      <span className="wp-token-key">ELSE</span> {fmtAct(rule.else)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      }}
    />
  );
}

// ---------- Constraints screen ----------
function ConstraintsScreen({ onEdit, onCreate, items, setItems }) {
  return (
    <ModuleListView
      kind="constraint"
      title="Constraints"
      subtitle="Constraints set rules between two wildcards' sub-categories — exclude, boost, or reduce specific combinations, with per-pair exceptions."
      items={items}
      setItems={setItems}
      onEdit={onEdit}
      onCreate={onCreate}
      newLabel="New Constraint"
      columns={[
        { key: "category", label: "Category", width: 130, render: (r) => {
          const c = WP_DATA.categories.find((x) => x.id === r.category);
          return c ? <Chip color={c.color}>{c.name}</Chip> : <span className="wp-dim">—</span>;
        } },
        { key: "pair", label: "Target × Source", width: 220, render: (r) => {
          const t = WP_DATA.wildcards.find((x) => x.id === r.target);
          const s = WP_DATA.wildcards.find((x) => x.id === r.source);
          return (
            <div className="wp-hsplit" style={{ gap: 6, fontSize: 12 }}>
              <Chip variant="accent" icon="pi-th-large">{t?.name || r.target}</Chip>
              <Icon name="pi-times" style={{ fontSize: 9, color: "var(--wp-text-dim)" }} />
              <Chip variant="accent" icon="pi-th-large">{s?.name || r.source}</Chip>
            </div>
          );
        } },
      ]}
      renderExpand={(row) => {
        const t = WP_DATA.wildcards.find((x) => x.id === row.target);
        const s = WP_DATA.wildcards.find((x) => x.id === row.source);
        const tSubs = t?.subCategories || [];
        const sSubs = s?.subCategories || [];
        const modeColor = { allow: null, exclude: "var(--wp-danger)", boost: "var(--wp-success)", reduce: "var(--wp-warn)" };
        const modeIcon = { allow: "·", exclude: "×", boost: "↑", reduce: "↓" };
        return (
          <div>
            <div className="wp-row-expand__title">Rule matrix</div>
            <table style={{ borderCollapse: "collapse", fontSize: 11.5 }}>
              <thead>
                <tr>
                  <th style={{ padding: "4px 8px", color: "var(--wp-text-dim)", fontWeight: 500, fontSize: 10, textTransform: "uppercase", letterSpacing: ".05em" }}>{t?.name} ↓ &nbsp; {s?.name} →</th>
                  {sSubs.map((sub) => <th key={sub} style={{ padding: "4px 8px", fontWeight: 500, color: "var(--wp-text-muted)" }}>{sub}</th>)}
                </tr>
              </thead>
              <tbody>
                {tSubs.map((tSub, ti) => (
                  <tr key={tSub}>
                    <td style={{ padding: "4px 8px", color: "var(--wp-text-muted)" }}>{tSub}</td>
                    {sSubs.map((sSub, si) => {
                      const raw = row.matrix[ti]?.[si];
                      const cell = raw == null ? { mode: "allow", factor: 1 }
                                  : typeof raw === "string" ? { mode: raw, factor: raw === "boost" ? 2 : raw === "reduce" ? 0.5 : 1 }
                                  : { mode: raw.mode || "allow", factor: typeof raw.factor === "number" ? raw.factor : (raw.mode === "boost" ? 2 : raw.mode === "reduce" ? 0.5 : 1) };
                      const c = modeColor[cell.mode];
                      const tunable = cell.mode === "boost" || cell.mode === "reduce";
                      const fmt = (f) => f >= 10 ? f.toFixed(0) : f.toFixed(2).replace(/\.?0+$/, "");
                      return (
                        <td key={sSub} style={{ padding: 3 }}>
                          <span title={tunable ? `${cell.mode} ×${fmt(cell.factor)}` : cell.mode} style={{
                            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 3,
                            minWidth: 26, height: 22, borderRadius: 5, padding: "0 5px",
                            background: c ? `color-mix(in oklab, ${c} 16%, transparent)` : "var(--wp-bg-3)",
                            color: c || "var(--wp-text-dim)",
                            border: `1px solid ${c ? `color-mix(in oklab, ${c} 35%, transparent)` : "var(--wp-border)"}`,
                            fontSize: 11, fontWeight: 600,
                          }}>
                            {modeIcon[cell.mode]}
                            {tunable && <span style={{ fontFamily: "var(--wp-font-mono)", fontSize: 9.5, opacity: 0.85 }}>×{fmt(cell.factor)}</span>}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {row.exceptions?.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div className="wp-dim" style={{ fontSize: 11 }}>{row.exceptions.length} per-pair exception{row.exceptions.length === 1 ? "" : "s"}</div>
              </div>
            )}
          </div>
        );
      }}
    />
  );
}

Object.assign(window, {
  WildcardsScreen, FixedValuesScreen, CombinesScreen, DerivationsScreen, ConstraintsScreen, PipelinesScreen,
});
function PipelinesScreen({ onEdit, onCreate, items, setItems }) {
  return (
    <ModuleListView
      kind="pipeline"
      title="Pipelines"
      subtitle="Pipelines are ordered presets of modules. They run top-to-bottom — each step appends to the resolved context the next step sees."
      items={items}
      setItems={setItems}
      onEdit={onEdit}
      onCreate={onCreate}
      newLabel="New Pipeline"
      columns={[
        { key: "category", label: "Category", width: 130, render: (r) => {
          const c = WP_DATA.categories.find((x) => x.id === r.category);
          return c ? <Chip color={c.color}>{c.name}</Chip> : <span className="wp-dim">—</span>;
        } },
        { key: "steps",   label: "Steps", width: 60, render: (r) => <span className="wp-mono">{r.steps.length}</span> },
        { key: "mix",     label: "Mix",   width: 132, render: (r) => {
          const counts = {};
          r.steps.forEach((s) => { counts[s.kind] = (counts[s.kind] || 0) + 1; });
          const order = ["wildcard", "fixed", "combine", "constraint", "derivation"];
          return (
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              {order.filter((k) => counts[k]).map((k) => {
                const m = KIND_META[k];
                return (
                  <span key={k} title={`${counts[k]} × ${m.label}`} style={{
                    display: "inline-flex", alignItems: "center", gap: 3,
                    padding: "2px 6px", borderRadius: 5, fontSize: 11,
                    background: `color-mix(in oklab, ${m.color} 14%, transparent)`,
                    color: m.color,
                    fontFamily: "var(--wp-font-mono)",
                  }}>
                    <Icon name={m.icon} style={{ fontSize: 9 }} />
                    {counts[k]}
                  </span>
                );
              })}
            </div>
          );
        } },
      ]}
      renderExpand={(row) => {
        const stepEl = (s, i) => {
          const m = KIND_META[s.kind];
          const list = { wildcard: WP_DATA.wildcards, fixed: WP_DATA.fixedValues, combine: WP_DATA.combines, derivation: WP_DATA.derivations, constraint: WP_DATA.constraints }[s.kind];
          const ref = list?.find((x) => x.id === s.refId);
          return (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "5px 10px", borderRadius: 6,
              background: "var(--wp-bg-2)", border: "1px solid var(--wp-border)",
              fontSize: 12, minWidth: 0,
            }}>
              <span style={{ fontFamily: "var(--wp-font-mono)", fontSize: 10, color: "var(--wp-text-dim)", width: 16 }}>{String(i + 1).padStart(2, "0")}</span>
              <span style={{
                width: 18, height: 18, borderRadius: 4, display: "grid", placeItems: "center",
                background: `color-mix(in oklab, ${m.color} 18%, transparent)`,
                color: m.color, fontSize: 10, flexShrink: 0,
              }}>
                <Icon name={m.icon} />
              </span>
              <span className="wp-dim" style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", flexShrink: 0 }}>{m.label}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ref?.name || s.refId}</span>
            </div>
          );
        };
        return (
          <div>
            <div className="wp-row-expand__title">{row.steps.length} step{row.steps.length === 1 ? "" : "s"} — top to bottom</div>
            <div style={{ display: "grid", gap: 4, maxWidth: 520 }}>
              {row.steps.slice(0, 6).map(stepEl)}
            </div>
            {row.steps.length > 6 && <div className="wp-dim" style={{ marginTop: 6, fontSize: 11.5 }}>… and {row.steps.length - 6} more</div>}
          </div>
        );
      }}
    />
  );
}
