/* global React, classNames, KIND_META */
// Reusable UI primitives — buttons, inputs, table chrome, etc.

const { useState, useRef, useEffect, useCallback } = React;

// ---------- PrimeIcon ----------
function Icon({ name, className, style }) {
  return <i className={classNames("pi", name, className)} style={style} />;
}

// ---------- Button ----------
function Button(props) {
  // Defensive prop extraction — Babel-standalone's destructure helper can leak
  // capitalized keys onto rest. Pull DOM-safe props by hand.
  const { variant = "default", size, icon, iconRight, className, children,
    onClick, onMouseDown, onMouseEnter, onMouseLeave, onFocus, onBlur,
    type, disabled, title, style, id, role,
    ...rest } = props;
  // Pass through aria-* and data-* only.
  const safeRest = {};
  for (const k in rest) {
    if (k.startsWith("aria-") || k.startsWith("data-")) safeRest[k] = rest[k];
  }
  return (
    <button
      className={classNames(
        "wp-btn",
        variant === "primary" && "wp-btn--primary",
        variant === "ghost" && "wp-btn--ghost",
        variant === "outline" && "wp-btn--outline",
        variant === "danger" && "wp-btn--danger",
        size === "sm" && "wp-btn--sm",
        !children && "wp-btn--icon",
        className,
      )}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={onFocus}
      onBlur={onBlur}
      type={type}
      disabled={disabled}
      title={title}
      style={style}
      id={id}
      role={role}
      {...safeRest}
    >
      {icon && <Icon name={icon} />}
      {children}
      {iconRight && <Icon name={iconRight} />}
    </button>
  );
}

// ---------- Input + field ----------
function Field({ label, hint, children, className, style }) {
  return (
    <div className={classNames("wp-field", className)} style={style}>
      {label && <label className="wp-field__label">{label}</label>}
      {children}
      {hint && <div className="wp-field__hint">{hint}</div>}
    </div>
  );
}

function Input(props) {
  const { size, className, ...rest } = props;
  return <input className={classNames("wp-input", size === "sm" && "wp-input--sm", className)} {...rest} />;
}

function Textarea(props) {
  return <textarea className="wp-textarea" {...props} />;
}

// ---------- Token autocomplete (for $-prefixed vars / @-prefixed wildcards) ----------
// Triggers when user types `trigger` followed by [a-z0-9_]+.
// Double-trigger ($$ or @@) is treated as escaped and never opens the popup.
function TokenAutocomplete({
  value, onChange, options,           // options: [{label, hint?}]
  trigger = "$", multiline = false, rows = 3,
  placeholder, mono = true, style, className,
}) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [start, setStart] = useState(-1); // index where the trigger sits
  const [active, setActive] = useState(0);
  const [flip, setFlip] = useState(false);

  // Flip the autocomplete popup above the input if there's not enough room below.
  useEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    const need = Math.min(260, 8 * 36 + 32);
    setFlip(spaceBelow < need + 16 && spaceAbove > spaceBelow);
  }, [open]);

  const probe = useCallback((str, caret) => {
    // Walk back from caret to find a trigger that:
    // - is preceded by a non-trigger char (or beginning of string), AND
    // - is not immediately followed by another trigger ($$ escape)
    // - the chars between trigger and caret are all [a-z0-9_]
    let i = caret - 1;
    while (i >= 0 && /[a-zA-Z0-9_]/.test(str[i])) i--;
    if (i < 0 || str[i] !== trigger) return null;
    // Check escape: if char before is the same trigger, ignore.
    if (i > 0 && str[i - 1] === trigger) return null;
    // Check not-double-trigger: if char immediately after the trigger is another trigger, ignore.
    if (str[i + 1] === trigger) return null;
    return { start: i, query: str.slice(i + 1, caret) };
  }, [trigger]);

  const filtered = open
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
    : [];

  const handleChange = (e) => {
    const next = e.target.value;
    onChange(next);
    const caret = e.target.selectionStart;
    const hit = probe(next, caret);
    if (hit) {
      setOpen(true);
      setStart(hit.start);
      setQuery(hit.query);
      setActive(0);
    } else {
      setOpen(false);
    }
  };

  const handleKeyDown = (e) => {
    if (!open || filtered.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % filtered.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + filtered.length) % filtered.length); }
    else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      apply(filtered[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const apply = (opt) => {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart;
    const before = value.slice(0, start);
    const after = value.slice(caret);
    const inserted = trigger + opt.label;
    const next = before + inserted + after;
    onChange(next);
    setOpen(false);
    requestAnimationFrame(() => {
      const pos = (before + inserted).length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const handleBlur = () => setTimeout(() => setOpen(false), 120);

  const commonProps = {
    ref, value,
    onChange: handleChange,
    onKeyDown: handleKeyDown,
    onBlur: handleBlur,
    placeholder,
    style: { fontFamily: mono ? "var(--wp-font-mono)" : undefined, fontSize: mono ? 12.5 : undefined, ...style },
    className: classNames(multiline ? "wp-textarea" : "wp-input", className),
  };

  return (
    <div style={{ position: "relative" }}>
      {multiline ? <textarea rows={rows} {...commonProps} /> : <input {...commonProps} />}
      {open && filtered.length > 0 && (
        <div className="wp-autocomplete" data-flip={flip ? "" : null}>
          <div className="wp-autocomplete__head">
            <span style={{ fontFamily: "var(--wp-font-mono)", color: "var(--wp-accent-text)" }}>{trigger}{query}</span>
            <span className="wp-dim" style={{ fontSize: 10.5, marginLeft: "auto" }}>↑↓ Enter · Esc</span>
          </div>
          {filtered.map((o, i) => (
            <button
              key={o.label}
              type="button"
              className="wp-autocomplete__item"
              data-active={i === active}
              onMouseDown={(e) => { e.preventDefault(); apply(o); }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="wp-autocomplete__label">
                <span style={{ color: "var(--wp-accent-text)" }}>{trigger}</span>{o.label}
              </span>
              {o.hint && <span className="wp-autocomplete__hint">{o.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Select (custom for consistent styling) ----------
function Select({ value, onChange, options, placeholder = "Select…", size, className, allowClear }) {
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const ref = useRef(null);
  const btnRef = useRef(null);
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  // When opening, decide whether to flip the dropdown above the trigger.
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    const need = Math.min(240, options.length * 30 + 12);
    setFlip(spaceBelow < need + 16 && spaceAbove > spaceBelow);
  }, [open, options.length]);
  const selected = options.find((o) => o.value === value);
  return (
    <div ref={ref} className={classNames("wp-select-wrap", className)} style={{ position: "relative" }}>
      <button
        ref={btnRef}
        type="button"
        className={classNames("wp-select", size === "sm" && "wp-select--sm")}
        onClick={() => setOpen((o) => !o)}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "space-between", textAlign: "left" }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1, overflow: "hidden" }}>
          {selected?.dot && <span className="wp-chip__dot" style={{ background: selected.dot, width: 8, height: 8 }} />}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: selected ? "var(--wp-text)" : "var(--wp-text-dim)" }}>
            {selected ? selected.label : placeholder}
          </span>
        </span>
        <Icon name="pi-chevron-down" style={{ fontSize: 11, color: "var(--wp-text-dim)" }} />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            ...(flip ? { bottom: "calc(100% + 4px)" } : { top: "calc(100% + 4px)" }),
            left: 0, right: 0,
            background: "var(--wp-bg-3)", border: "1px solid var(--wp-border-strong)",
            borderRadius: 7, boxShadow: "var(--wp-shadow-lg)", zIndex: 50,
            padding: 4, maxHeight: 240, overflow: "auto",
          }}
        >
          {allowClear && (
            <div
              className="wp-list__row"
              style={{ padding: "6px 8px", color: "var(--wp-text-dim)", borderRadius: 6 }}
              onClick={() => { onChange(null); setOpen(false); }}
            >
              <Icon name="pi-times-circle" style={{ fontSize: 12 }} />
              Clear
            </div>
          )}
          {options.map((o) => (
            <div
              key={o.value}
              className="wp-list__row"
              style={{
                padding: "6px 8px", borderRadius: 6,
                background: o.value === value ? "color-mix(in oklab, var(--wp-accent-500) 16%, transparent)" : undefined,
                color: o.value === value ? "var(--wp-text)" : "var(--wp-text-muted)",
              }}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              {o.dot && <span className="wp-chip__dot" style={{ background: o.dot, width: 8, height: 8 }} />}
              <span style={{ flex: 1 }}>{o.label}</span>
              {o.value === value && <Icon name="pi-check" style={{ fontSize: 11, color: "var(--wp-accent-text)" }} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Checkbox ----------
function Checkbox({ checked, onChange, indeterminate }) {
  return (
    <button
      type="button"
      className="wp-check"
      data-checked={checked}
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      aria-checked={checked}
    >
      {indeterminate ? (
        <svg viewBox="0 0 12 12" fill="none" style={{ display: "block" }}><path d="M3 6h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
      ) : checked ? (
        <svg viewBox="0 0 12 12" fill="none" style={{ display: "block" }}><path d="M3 6.2l2.2 2.2L9 4.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
      ) : null}
    </button>
  );
}

// ---------- Toggle ----------
function Toggle({ on, onChange }) {
  return <button type="button" className="wp-toggle" data-on={on} onClick={() => onChange(!on)} />;
}

// ---------- Star ----------
function Star({ on, onChange, size = 14 }) {
  return (
    <button type="button" className="wp-star" data-on={on} onClick={(e) => { e.stopPropagation(); onChange(!on); }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
        <path d="M12 2.6l2.95 6 6.6.95-4.78 4.66 1.13 6.58L12 17.7l-5.9 3.1L7.23 14.2 2.45 9.55l6.6-.95L12 2.6z"/>
      </svg>
    </button>
  );
}

// ---------- Chip ----------
function Chip({ children, color, variant, icon, onClose }) {
  const style = color ? {
    color: color,
    background: `color-mix(in oklab, ${color} 14%, transparent)`,
    borderColor: `color-mix(in oklab, ${color} 35%, transparent)`,
  } : undefined;
  return (
    <span className={classNames("wp-chip", variant && `wp-chip--${variant}`)} style={style}>
      {icon && <Icon name={icon} style={{ fontSize: 10 }} />}
      {children}
      {onClose && <Icon name="pi-times" style={{ fontSize: 9, cursor: "pointer", marginLeft: 2 }} onClick={onClose} />}
    </span>
  );
}

// ---------- Tag input (auto-complete style) ----------
function TagInput({ value = [], onChange, placeholder = "Type a tag and press Enter…" }) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const v = draft.trim();
    if (v && !value.includes(v)) onChange([...value, v]);
    setDraft("");
  };
  return (
    <div
      className="wp-input"
      style={{ height: "auto", minHeight: "var(--wp-input-h)", display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", padding: 4, paddingLeft: 8 }}
    >
      {value.map((t) => (
        <Chip key={t} variant="accent" onClose={() => onChange(value.filter((x) => x !== t))}>{t}</Chip>
      ))}
      <input
        style={{ flex: 1, minWidth: 120, background: "transparent", border: "none", outline: "none", color: "inherit", padding: "4px 4px", fontSize: "12.5px" }}
        placeholder={value.length === 0 ? placeholder : ""}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={commit}
      />
    </div>
  );
}

// ---------- Card ----------
function Card({ title, action, children, className, padded = true, style }) {
  return (
    <div className={classNames("wp-card", className)} style={style}>
      {title && (
        <div className="wp-card__header">
          <h3 className="wp-card__title">{title}</h3>
          <div className="wp-spacer" />
          {action}
        </div>
      )}
      <div className={padded ? "wp-card__body" : ""} style={padded ? undefined : { padding: 0 }}>{children}</div>
    </div>
  );
}

// ---------- Toast ----------
function useToasts() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, opts = {}) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, icon: opts.icon || "pi-check-circle" }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2400);
  }, []);
  const node = (
    <div className="wp-toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className="wp-toast">
          <Icon name={t.icon} style={{ color: "var(--wp-accent-text)" }} />
          {t.msg}
        </div>
      ))}
    </div>
  );
  return [node, push];
}

// ---------- Module-kind chip ----------
function KindChip({ kind }) {
  const m = KIND_META[kind];
  if (!m) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--wp-text-muted)" }}>
      <span style={{
        width: 18, height: 18, borderRadius: 5, display: "grid", placeItems: "center",
        background: `color-mix(in oklab, ${m.color} 16%, transparent)`,
        color: m.color, fontSize: 10,
      }}>
        <Icon name={m.icon} />
      </span>
      {m.label}
    </span>
  );
}

Object.assign(window, {
  Icon, Button, Field, Input, Textarea, Select, Checkbox, Toggle, Star, Chip, TagInput, Card, useToasts, KindChip, TokenAutocomplete,
});
