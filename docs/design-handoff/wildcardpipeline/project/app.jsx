/* global React, ReactDOM, WP_DATA, useToasts,
   Topbar, Sidebar, PageHeader, Dashboard, useTheme,
   WildcardsScreen, FixedValuesScreen, CombinesScreen, DerivationsScreen, ConstraintsScreen, PipelinesScreen,
   CategoriesScreen, ImportExportScreen, TestRunnerScreen, SettingsScreen,
   WildcardEditor, FixedValuesEditor, CombineEditor, DerivationEditor, ConstraintEditor, PipelineEditor,
   TweaksPanel, useTweaks, TweakSection, TweakRadio, TweakSelect, TweakToggle */
const { useState, useEffect, useMemo } = React;

// Accent palette presets
const ACCENT_PRESETS = {
  violet: { 300: "#c4b5fd", 400: "#a78bfa", 500: "#8b5cf6", 600: "#7c3aed", 700: "#6d28d9" },
  indigo: { 300: "#a5b4fc", 400: "#818cf8", 500: "#6366f1", 600: "#4f46e5", 700: "#4338ca" },
  teal:   { 300: "#5eead4", 400: "#2dd4bf", 500: "#14b8a6", 600: "#0d9488", 700: "#0f766e" },
  rose:   { 300: "#fda4af", 400: "#fb7185", 500: "#f43f5e", 600: "#e11d48", 700: "#be123c" },
  amber:  { 300: "#fcd34d", 400: "#fbbf24", 500: "#f59e0b", 600: "#d97706", 700: "#b45309" },
};

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "violet",
  "density": "compact",
  "sidebar": "expanded",
  "showFavoritesInSidebar": false
}/*EDITMODE-END*/;

function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [theme, setTheme] = useTheme();
  const [route, setRoute] = useState({ name: "dashboard" });
  const [toastNode, pushToast] = useToasts();

  // Mutable copies of seed data
  const [wildcards,   setWildcards]   = useState(WP_DATA.wildcards);
  const [fixedValues, setFixedValues] = useState(WP_DATA.fixedValues);
  const [combines,    setCombines]    = useState(WP_DATA.combines);
  const [derivations, setDerivations] = useState(WP_DATA.derivations);
  const [constraints, setConstraints] = useState(WP_DATA.constraints);
  const [pipelines,   setPipelines]   = useState(WP_DATA.pipelines);
  const [categories,  setCategories]  = useState(WP_DATA.categories);

  // Apply accent tweak to CSS vars
  useEffect(() => {
    const p = ACCENT_PRESETS[tweaks.accent] || ACCENT_PRESETS.violet;
    const root = document.documentElement;
    Object.entries(p).forEach(([k, v]) => root.style.setProperty(`--wp-accent-${k}`, v));
  }, [tweaks.accent]);

  useEffect(() => {
    document.documentElement.style.setProperty("--wp-input-h", tweaks.density === "comfortable" ? "38px" : "34px");
    document.documentElement.style.setProperty("--wp-btn-h",   tweaks.density === "comfortable" ? "38px" : "34px");
  }, [tweaks.density]);

  const navigate = (id) => {
    if (id === "_settings") setRoute({ name: "settings" });
    else setRoute({ name: id });
  };

  const onCreate = (kind) => setRoute({ name: kind + ":new" });
  const onEdit = (kind, id) => setRoute({ name: kind + ":edit", id });

  const sidebarActive = (() => {
    const base = route.name.split(":")[0];
    // Singular editor routes -> plural sidebar ids
    return ({
      wildcard:   "wildcards",
      fixed:      "fixed",
      combine:    "combines",
      derivation: "derivations",
      constraint: "constraints",
      pipeline:   "pipelines",
    })[base] || base;
  })();

  const collapsed = tweaks.sidebar === "collapsed";

  // Render content
  const content = (() => {
    const r = route.name;
    if (r === "dashboard")   return <Dashboard onNavigate={(id) => setRoute({ name: id })} onCreate={(k) => onCreate(k)} />;
    if (r === "wildcards")   return <WildcardsScreen items={wildcards}   setItems={setWildcards}   onEdit={(id) => onEdit("wildcard", id)}   onCreate={() => onCreate("wildcard")} />;
    if (r === "fixed")       return <FixedValuesScreen items={fixedValues} setItems={setFixedValues} onEdit={(id) => onEdit("fixed", id)}     onCreate={() => onCreate("fixed")} />;
    if (r === "combines")    return <CombinesScreen items={combines}    setItems={setCombines}    onEdit={(id) => onEdit("combine", id)}    onCreate={() => onCreate("combine")} />;
    if (r === "derivations") return <DerivationsScreen items={derivations} setItems={setDerivations} onEdit={(id) => onEdit("derivation", id)} onCreate={() => onCreate("derivation")} />;
    if (r === "constraints") return <ConstraintsScreen items={constraints} setItems={setConstraints} onEdit={(id) => onEdit("constraint", id)} onCreate={() => onCreate("constraint")} />;
    if (r === "pipelines")   return <PipelinesScreen items={pipelines}   setItems={setPipelines}   onEdit={(id) => onEdit("pipeline", id)}   onCreate={() => onCreate("pipeline")} />;
    if (r === "categories")  return <CategoriesScreen items={categories} setItems={setCategories} />;
    if (r === "io")          return <ImportExportScreen pushToast={pushToast} />;
    if (r === "test")        return <TestRunnerScreen />;
    if (r === "settings")    return <SettingsScreen tweaks={tweaks} setTweak={setTweak} />;
    if (r === "community")   return <CommunityScreen />;

    // Editor routes
    const back = (kind) => ({ wildcard: "wildcards", fixed: "fixed", combine: "combines", derivation: "derivations", constraint: "constraints", pipeline: "pipelines" }[kind]);
    const save = (kind, items, setItems, value) => {
      if (route.name.endsWith(":new")) {
        const newId = window.makeId(({ wildcard: "wc", fixed: "fv", combine: "cb", derivation: "dv", constraint: "cn", pipeline: "pl" }[kind]));
        setItems([{ ...value, id: newId, updatedAt: Date.now(), favorite: false, valid: true, history: [] }, ...items]);
        pushToast(`Created “${value.name || "Untitled"}”.`);
      } else {
        setItems(items.map((x) => {
          if (x.id !== route.id) return x;
          // Snapshot the pre-save state into history (cap at 3).
          const { history: _h, ...prev } = x;
          const snapshot = { ...prev, savedAt: Date.now() };
          const history = [snapshot, ...(x.history || [])].slice(0, 3);
          return { ...x, ...value, updatedAt: Date.now(), history };
        }));
        pushToast(`Saved “${value.name || "Untitled"}”.`);
      }
      setRoute({ name: back(kind) });
    };

    if (r === "wildcard:new" || r === "wildcard:edit") {
      const initial = r === "wildcard:edit" ? wildcards.find((x) => x.id === route.id) : undefined;
      return <WildcardEditor isNew={r.endsWith(":new")} initial={initial} onCancel={() => setRoute({ name: "wildcards" })} onSave={(v) => save("wildcard", wildcards, setWildcards, v)} />;
    }
    if (r === "fixed:new" || r === "fixed:edit") {
      const initial = r === "fixed:edit" ? fixedValues.find((x) => x.id === route.id) : undefined;
      return <FixedValuesEditor isNew={r.endsWith(":new")} initial={initial} onCancel={() => setRoute({ name: "fixed" })} onSave={(v) => save("fixed", fixedValues, setFixedValues, v)} />;
    }
    if (r === "combine:new" || r === "combine:edit") {
      const initial = r === "combine:edit" ? combines.find((x) => x.id === route.id) : undefined;
      return <CombineEditor isNew={r.endsWith(":new")} initial={initial} onCancel={() => setRoute({ name: "combines" })} onSave={(v) => save("combine", combines, setCombines, v)} />;
    }
    if (r === "derivation:new" || r === "derivation:edit") {
      const initial = r === "derivation:edit" ? derivations.find((x) => x.id === route.id) : undefined;
      return <DerivationEditor isNew={r.endsWith(":new")} initial={initial} onCancel={() => setRoute({ name: "derivations" })} onSave={(v) => save("derivation", derivations, setDerivations, v)} />;
    }
    if (r === "constraint:new" || r === "constraint:edit") {
      const initial = r === "constraint:edit" ? constraints.find((x) => x.id === route.id) : undefined;
      return <ConstraintEditor isNew={r.endsWith(":new")} initial={initial} onCancel={() => setRoute({ name: "constraints" })} onSave={(v) => save("constraint", constraints, setConstraints, v)} />;
    }
    if (r === "pipeline:new" || r === "pipeline:edit") {
      const initial = r === "pipeline:edit" ? pipelines.find((x) => x.id === route.id) : undefined;
      return <PipelineEditor isNew={r.endsWith(":new")} initial={initial} onCancel={() => setRoute({ name: "pipelines" })} onSave={(v) => save("pipeline", pipelines, setPipelines, v)} />;
    }

    return <Dashboard onNavigate={(id) => setRoute({ name: id })} onCreate={(k) => onCreate(k)} />;
  })();

  return (
    <CommunityProvider pushToast={pushToast}>
    <div className="wp-app">
      <Topbar
        onToggleSidebar={() => setTweak("sidebar", collapsed ? "expanded" : "collapsed")}
        onOpenSettings={() => setRoute({ name: "settings" })}
        theme={theme}
        onCycleTheme={() => setTheme(theme === "dark" ? "light" : theme === "light" ? "auto" : "dark")}
        extras={<CommunityTopbarPill />}
      />
      <div className="wp-body" data-collapsed={collapsed}>
        <Sidebar active={sidebarActive} onNavigate={navigate} collapsed={collapsed} />
        <main className="wp-content">{content}</main>
      </div>
      {toastNode}
      <TweaksPanel title="Tweaks">
        <TweakSection label="Appearance">
          <TweakRadio label="Accent"
            value={tweaks.accent}
            onChange={(v) => setTweak("accent", v)}
            options={[
              { value: "violet", label: "Violet" },
              { value: "indigo", label: "Indigo" },
              { value: "teal",   label: "Teal" },
              { value: "rose",   label: "Rose" },
              { value: "amber",  label: "Amber" },
            ]}
          />
          <TweakRadio label="Density"
            value={tweaks.density}
            onChange={(v) => setTweak("density", v)}
            options={[
              { value: "compact",     label: "Compact" },
              { value: "comfortable", label: "Comfortable" },
            ]}
          />
          <TweakRadio label="Sidebar"
            value={tweaks.sidebar}
            onChange={(v) => setTweak("sidebar", v)}
            options={[
              { value: "expanded",  label: "Expanded" },
              { value: "collapsed", label: "Collapsed" },
            ]}
          />
        </TweakSection>
        <TweakSection label="Navigation">
          <TweakSelect label="Jump to screen"
            value={route.name}
            onChange={(v) => setRoute({ name: v })}
            options={[
              { value: "dashboard",   label: "Dashboard" },
              { value: "pipelines",   label: "Pipelines" },
              { value: "wildcards",   label: "Wildcards" },
              { value: "fixed",       label: "Fixed Values" },
              { value: "combines",    label: "Combines" },
              { value: "derivations", label: "Derivations" },
              { value: "constraints", label: "Constraints" },
              { value: "categories",  label: "Categories" },
              { value: "io",          label: "Import / Export" },
              { value: "test",        label: "Test Runner" },
              { value: "community",   label: "Community" },
              { value: "settings",    label: "Settings" },
            ]}
          />
        </TweakSection>
      </TweaksPanel>
    </div>
    </CommunityProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
