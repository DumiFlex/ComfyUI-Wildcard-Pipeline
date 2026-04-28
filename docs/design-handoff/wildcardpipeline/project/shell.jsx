/* global React, Icon, classNames */
const { useState, useEffect, useRef } = React;

// ---------- Theme hook ----------
// Adds `wp-theme-switching` to <html> for ~140ms around theme changes so we can
// suppress transitions on every element and avoid the cross-fade flash.
const THEME_KEY = "wp_theme";
function useTheme() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem(THEME_KEY) || "auto"; } catch { return "auto"; }
  });
  const isFirstRun = useRef(true);
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const resolved = theme === "auto"
        ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
        : theme;
      root.classList.toggle("wp-theme-light", resolved === "light");
      root.classList.toggle("wp-theme-dark", resolved === "dark");
    };
    if (!isFirstRun.current) {
      root.classList.add("wp-theme-switching");
      apply();
      // double rAF so the switch lands in one paint, then re-enable transitions
      requestAnimationFrame(() => requestAnimationFrame(() => {
        setTimeout(() => root.classList.remove("wp-theme-switching"), 30);
      }));
    } else {
      apply();
      isFirstRun.current = false;
    }
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
    if (theme === "auto") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme]);
  return [theme, setTheme];
}

// ---------- Topbar ----------
function Topbar({ onToggleSidebar, onOpenSettings, theme, onCycleTheme, extras }) {
  const themeIcon = theme === "light" ? "pi-sun" : theme === "dark" ? "pi-moon" : "pi-desktop";
  const themeLabel = `Theme: ${theme}`;
  return (
    <header className="wp-topbar">
      <button className="wp-topbar__icon-btn" onClick={onToggleSidebar} aria-label="Toggle sidebar">
        <Icon name="pi-bars" />
      </button>
      <div className="wp-topbar__brand">
        <img src="assets/logo-color.png" alt="" />
        <span>Wildcard Pipeline</span>
        <span className="wp-topbar__version">v1.4.2-dev</span>
      </div>
      <div className="wp-topbar__spacer" />
      {extras}
      <button className="wp-topbar__icon-btn" onClick={onCycleTheme} title={themeLabel} aria-label={themeLabel}>
        <Icon name={themeIcon} />
      </button>
      <button className="wp-topbar__icon-btn" title="Documentation">
        <Icon name="pi-question-circle" />
      </button>
      <button className="wp-topbar__icon-btn" onClick={onOpenSettings} title="Settings">
        <Icon name="pi-cog" />
      </button>
    </header>
  );
}

// ---------- Sidebar ----------
const NAV_SECTIONS = [
  {
    label: "Home",
    items: [
      { id: "dashboard", label: "Dashboard", icon: "pi-home" },
    ],
  },
  {
    label: "Modules",
    items: [
      { id: "pipelines",   label: "Pipelines",    icon: "pi-list" },
      { id: "wildcards",   label: "Wildcards",    icon: "pi-th-large" },
      { id: "fixed",       label: "Fixed Values", icon: "pi-tag" },
      { id: "combines",    label: "Combines",     icon: "pi-share-alt" },
      { id: "derivations", label: "Derivations",  icon: "pi-code" },
      { id: "constraints", label: "Constraints",  icon: "pi-sitemap" },
    ],
  },
  {
    label: "Library",
    items: [
      { id: "categories", label: "Categories",   icon: "pi-bookmark" },
      { id: "io",         label: "Import / Export", icon: "pi-arrow-right-arrow-left" },
      { id: "test",       label: "Test Runner",  icon: "pi-bolt" },
    ],
  },
  {
    label: "Get Started",
    items: [
      { id: "community", label: "Community",   icon: "pi-globe" },
      { id: "_docs",     label: "Documentation", icon: "pi-book", external: true },
      { id: "_source",   label: "View Source",   icon: "pi-github", external: true },
    ],
  },
];

function Sidebar({ active, onNavigate, collapsed }) {
  return (
    <nav className="wp-sidebar">
      {NAV_SECTIONS.map((section) => (
        <React.Fragment key={section.label}>
          {!collapsed && <div className="wp-sidebar__section">{section.label}</div>}
          {collapsed && <div style={{ height: 8 }} />}
          {section.items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="wp-nav"
              data-active={active === item.id}
              onClick={() => !item.external && onNavigate(item.id)}
              title={collapsed ? item.label : undefined}
              style={collapsed ? { justifyContent: "center" } : undefined}
            >
              <span className="wp-nav__icon"><Icon name={item.icon} /></span>
              {!collapsed && <span className="wp-nav__label">{item.label}</span>}
              {!collapsed && item.external && <Icon name="pi-external-link" className="wp-nav__ext" style={{ fontSize: 10 }} />}
            </button>
          ))}
        </React.Fragment>
      ))}
    </nav>
  );
}

// ---------- Page header ----------
function PageHeader({ title, subtitle, actions, breadcrumb }) {
  return (
    <div className="wp-page__header">
      <div className="wp-page__title-wrap">
        {breadcrumb}
        <h1 className="wp-page__title">{title}</h1>
        {subtitle && <p className="wp-page__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="wp-hsplit" style={{ gap: 8 }}>{actions}</div>}
    </div>
  );
}

Object.assign(window, { Topbar, Sidebar, PageHeader, useTheme });
