/* global React, ReactDOM, classNames, Icon */
// Rich text input with syntax highlighting overlay for:
//   - $varname tokens (chip-rendered, click to open properties)
//   - {a|b|c} dynamic-prompt segments (highlighted brackets + dividers)
//   - {N$$sep$$a|b|c} multi-select with separator (highlighted)
//   - {N::a} weighted choices (highlighted weight)
//   - N#$var quantifier (highlighted prefix)
//   - # comments (dimmed)
//
// Uses an overlay <div> mirror behind a transparent <textarea>/<input>. The
// mirror renders styled spans for syntax. The text in the mirror MUST line up
// exactly with the textarea text (same font, padding, line-height, white-space)
// so the syntax highlights sit underneath the user-visible characters.

const { useState: useRTState, useRef: useRTRef, useEffect: useRTEffect, useCallback: useRTCallback, useMemo: useRTMemo } = React;

// ---------- Tokenizer ----------
function tokenizeRich(text) {
  const out = [];
  let i = 0;
  const N = text.length;

  while (i < N) {
    const ch = text[i];

    // Comment: # at line start (or after whitespace) to end of line
    if (ch === "#" && (i === 0 || /\s/.test(text[i - 1]))) {
      let j = i;
      while (j < N && text[j] !== "\n") j++;
      out.push({ kind: "comment", text: text.slice(i, j), start: i, end: j });
      i = j;
      continue;
    }

    // Quantifier prefix: digits + #  followed by $ or {
    if (/[0-9]/.test(ch)) {
      const m = text.slice(i).match(/^(\d+)#(?=[$\{])/);
      if (m) {
        out.push({ kind: "quantifier", text: m[0], start: i, end: i + m[0].length, meta: { count: Number(m[1]) } });
        i += m[0].length;
        continue;
      }
      // fall through: digits are plain text
    }

    // Dynamic prompt {…|…}
    if (ch === "{") {
      let depth = 1;
      let j = i + 1;
      while (j < N && depth > 0) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}") depth--;
        if (depth > 0) j++;
      }
      if (depth === 0) {
        const inner = text.slice(i + 1, j);
        const fullEnd = j + 1;
        const multi = inner.match(/^(-?\d+(?:-\d+)?)\$\$(?:([^$]*)\$\$)?/);
        const headerLen = multi ? multi[0].length : 0;
        const headerStart = i + 1;
        const headerEnd = headerStart + headerLen;

        out.push({ kind: "dp-brace", text: "{", start: i, end: i + 1 });
        if (multi) {
          out.push({
            kind: "dp-multi",
            text: multi[0],
            start: headerStart,
            end: headerEnd,
            meta: { range: multi[1], sep: multi[2] || null },
          });
        }

        let k = headerEnd;
        let optStart = k;
        let innerDepth = 0;
        const flushOption = (endIdx) => {
          if (endIdx > optStart) {
            const segText = text.slice(optStart, endIdx);
            const w = segText.match(/^(\d+(?:\.\d+)?)::/);
            if (w) {
              out.push({ kind: "dp-weight", text: w[0], start: optStart, end: optStart + w[0].length, meta: { weight: Number(w[1]) } });
              const subTokens = tokenizeRich(segText.slice(w[0].length));
              for (const t of subTokens) {
                out.push({ ...t, start: t.start + optStart + w[0].length, end: t.end + optStart + w[0].length });
              }
            } else {
              const subTokens = tokenizeRich(segText);
              for (const t of subTokens) {
                out.push({ ...t, start: t.start + optStart, end: t.end + optStart });
              }
            }
          }
        };
        while (k < j) {
          if (text[k] === "{") innerDepth++;
          else if (text[k] === "}") innerDepth--;
          else if (text[k] === "|" && innerDepth === 0) {
            flushOption(k);
            out.push({ kind: "dp-pipe", text: "|", start: k, end: k + 1 });
            optStart = k + 1;
          }
          k++;
        }
        flushOption(j);
        out.push({ kind: "dp-brace", text: "}", start: j, end: fullEnd });
        i = fullEnd;
        continue;
      }
      // Unmatched brace — fall through, treat as plain text
    }

    // $$ literal escape
    if (ch === "$" && text[i + 1] === "$") {
      out.push({ kind: "escape", text: "$$", start: i, end: i + 2 });
      i += 2;
      continue;
    }
    // @@ literal escape
    if (ch === "@" && text[i + 1] === "@") {
      out.push({ kind: "escape", text: "@@", start: i, end: i + 2 });
      i += 2;
      continue;
    }
    // $varname token
    if (ch === "$") {
      const m = text.slice(i + 1).match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
      if (m) {
        out.push({ kind: "var", text: "$" + m[1], start: i, end: i + 1 + m[1].length, meta: { name: m[1] } });
        i += 1 + m[1].length;
        continue;
      }
    }
    // @varname (nested wildcard reference)
    if (ch === "@") {
      const m = text.slice(i + 1).match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
      if (m) {
        out.push({ kind: "ref", text: "@" + m[1], start: i, end: i + 1 + m[1].length, meta: { name: m[1] } });
        i += 1 + m[1].length;
        continue;
      }
    }

    // Plain text run — accumulate until next char that COULD start a special token.
    // Always advance at least 1 char to guarantee progress.
    let j = i + 1;
    while (j < N) {
      const c = text[j];
      if (c === "$" || c === "@" || c === "{") break;
      if (c === "#" && (j === 0 || /\s/.test(text[j - 1]))) break;
      if (/[0-9]/.test(c) && /^\d+#[$\{]/.test(text.slice(j))) break;
      j++;
    }
    out.push({ kind: "text", text: text.slice(i, j), start: i, end: j });
    i = j;
  }
  return out;
}

// ---------- RichTextInput ----------
//
// Two render modes for the syntax-highlight mirror:
//   - FOCUSED  — chips render zero-width (background + box-shadow only, no
//                padding/margin/border). Mirror text positions match the
//                textarea exactly, so the native caret sits where it should.
//   - BLURRED  — chips render with real padding + rounded pill chrome so the
//                value reads as nicely-styled tokens at rest.
// Switching the visual treatment by focus avoids fighting the textarea's
// caret math: we only care about pixel-perfect alignment while typing.
function RichTextInput({
  value,
  onChange,
  multiline = false,
  rows = 3,
  placeholder,
  options = [],
  refOptions = null,
  triggers = ["$"],
  onTokenClick,
  className,
  style,
  mono = true,
}) {
  const taRef = useRTRef(null);
  const mirrorRef = useRTRef(null);
  const [focused, setFocused] = useRTState(false);

  const [acOpen, setAcOpen] = useRTState(false);
  const [acQuery, setAcQuery] = useRTState("");
  const [acTrigger, setAcTrigger] = useRTState("$");
  const [acStart, setAcStart] = useRTState(-1);
  const [acActive, setAcActive] = useRTState(0);

  const tokens = useRTMemo(() => tokenizeRich(value || ""), [value]);

  // Sync mirror scroll with textarea scroll
  const syncScroll = useRTCallback(() => {
    if (taRef.current && mirrorRef.current) {
      mirrorRef.current.scrollTop = taRef.current.scrollTop;
      mirrorRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  }, []);
  useRTEffect(() => { syncScroll(); }, [value, syncScroll]);

  const probeAutocomplete = useRTCallback((str, caret) => {
    let i = caret - 1;
    while (i >= 0 && /[a-zA-Z0-9_]/.test(str[i])) i--;
    if (i < 0) return null;
    const trigger = str[i];
    if (!triggers.includes(trigger)) return null;
    if (i > 0 && str[i - 1] === trigger) return null;
    if (str[i + 1] === trigger) return null;
    return { start: i, query: str.slice(i + 1, caret), trigger };
  }, [triggers]);

  const acItems = acOpen
    ? (acTrigger === "@" && refOptions ? refOptions : options)
        .filter((o) => o.label.toLowerCase().includes(acQuery.toLowerCase()))
        .slice(0, 8)
    : [];

  const handleChange = (e) => {
    const next = e.target.value;
    onChange(next);
    const caret = e.target.selectionStart;
    const hit = probeAutocomplete(next, caret);
    if (hit) {
      setAcOpen(true);
      setAcStart(hit.start);
      setAcQuery(hit.query);
      setAcTrigger(hit.trigger);
      setAcActive(0);
    } else {
      setAcOpen(false);
    }
  };

  const handleKeyDown = (e) => {
    if (acOpen && acItems.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setAcActive((a) => (a + 1) % acItems.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setAcActive((a) => (a - 1 + acItems.length) % acItems.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); applyAutocomplete(acItems[acActive]); return; }
      if (e.key === "Escape") { setAcOpen(false); return; }
    }
  };

  const applyAutocomplete = (opt) => {
    const el = taRef.current;
    if (!el) return;
    const caret = el.selectionStart;
    const before = (value || "").slice(0, acStart);
    const after = (value || "").slice(caret);
    const inserted = acTrigger + opt.label;
    const next = before + inserted + after;
    onChange(next);
    setAcOpen(false);
    requestAnimationFrame(() => {
      const pos = (before + inserted).length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const handleMirrorMouseDown = (e) => {
    if (!onTokenClick) return;
    const target = e.target.closest(".wp-rt-var");
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = target.getBoundingClientRect();
    const idx = Number(target.dataset.tokenIdx);
    const tok = tokens[idx];
    if (tok) onTokenClick(tok, rect);
  };

  // Mirror layer renders tokens via React (safer than dangerouslySetInnerHTML).
  const taProps = {
    ref: taRef,
    value: value || "",
    onChange: handleChange,
    onKeyDown: handleKeyDown,
    onScroll: syncScroll,
    onFocus: () => setFocused(true),
    onBlur: () => { setFocused(false); setTimeout(() => setAcOpen(false), 120); },
    placeholder,
    spellCheck: false,
    className: classNames("wp-rt__input", multiline ? "wp-rt__input--multi" : "wp-rt__input--single", className),
    style: { fontFamily: mono ? "var(--wp-font-mono)" : undefined, ...style },
  };

  return (
    <div className="wp-rt" data-focused={focused ? "" : null} data-multi={multiline ? "" : null}>
      <div
        ref={mirrorRef}
        className={classNames("wp-rt__mirror", multiline ? "wp-rt__mirror--multi" : "wp-rt__mirror--single", focused ? "wp-rt__mirror--editing" : "wp-rt__mirror--rest")}
        style={{ fontFamily: mono ? "var(--wp-font-mono)" : undefined, ...style }}
        aria-hidden
        onMouseDown={handleMirrorMouseDown}
      >
        {tokens.map((t, idx) => (
          <span
            key={idx}
            className={`wp-rt-${t.kind}`}
            data-token-idx={t.kind === "var" ? idx : undefined}
          >
            {t.text}
          </span>
        ))}
        {/* Trailing zero-width space — ensures the mirror grows to match a final newline */}
        <span className="wp-rt-tail">{"\u200B"}</span>
      </div>
      {multiline ? <textarea rows={rows} {...taProps} /> : <input {...taProps} />}
      {acOpen && acItems.length > 0 && (
        <div className="wp-autocomplete">
          <div className="wp-autocomplete__head">
            <span style={{ fontFamily: "var(--wp-font-mono)", color: "var(--wp-accent-text)" }}>{acTrigger}{acQuery}</span>
            <span className="wp-dim" style={{ fontSize: 10.5, marginLeft: "auto" }}>↑↓ Enter · Esc</span>
          </div>
          {acItems.map((o, i) => (
            <button
              key={o.label}
              type="button"
              className="wp-autocomplete__item"
              data-active={i === acActive}
              onMouseDown={(e) => { e.preventDefault(); applyAutocomplete(o); }}
              onMouseEnter={() => setAcActive(i)}
            >
              <span className="wp-autocomplete__label">
                <span style={{ color: "var(--wp-accent-text)" }}>{acTrigger}</span>{o.label}
              </span>
              {o.hint && <span className="wp-autocomplete__hint">{o.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Preview-only renderer ----------
function RichTextPreview({ value }) {
  const tokens = useRTMemo(() => tokenizeRich(value || ""), [value]);
  return (
    <span className="wp-rt__preview">
      {tokens.map((t, i) => (
        <span key={i} className={`wp-rt-${t.kind}`}>{t.text}</span>
      ))}
    </span>
  );
}

// ---------- Token properties popover ----------
// Edits per-reference modifiers on a $var token by rewriting the source string.
// Modifiers (Impact-pack syntax):
//   {N$$ sep $$$var}   multi-select count + custom separator
//   N#$var             quantifier (resolve N times independently)
function TokenPropsPopover({ token, rect, value, onChange, onClose, optionInfo }) {
  // Detect existing wrapping syntax around this token
  const ctx = useRTMemo(() => {
    const def = { count: 1, separator: ", ", quantifier: 1, wrapStart: token?.start ?? 0, wrapEnd: token?.end ?? 0 };
    if (!token || !value) return def;
    let { count, separator, quantifier, wrapStart, wrapEnd } = def;
    wrapStart = token.start;
    wrapEnd = token.end;

    // Quantifier prefix: \d+# right before token
    const quantMatch = value.slice(0, token.start).match(/(\d+)#$/);
    if (quantMatch) {
      quantifier = Number(quantMatch[1]);
      wrapStart = token.start - quantMatch[0].length;
    }

    // Multi-select wrap: walk back to nearest unmatched `{`
    let openIdx = -1;
    let depth = 0;
    for (let i = wrapStart - 1; i >= 0; i--) {
      if (value[i] === "}") depth++;
      else if (value[i] === "{") {
        if (depth === 0) { openIdx = i; break; }
        depth--;
      }
    }
    if (openIdx !== -1) {
      let closeIdx = -1;
      let d = 1;
      for (let j = openIdx + 1; j < value.length; j++) {
        if (value[j] === "{") d++;
        else if (value[j] === "}") { d--; if (d === 0) { closeIdx = j; break; } }
      }
      if (closeIdx !== -1) {
        const inner = value.slice(openIdx + 1, closeIdx);
        const headerMatch = inner.match(/^(-?\d+(?:-\d+)?)\$\$(?:([^$]*)\$\$)?/);
        if (headerMatch) {
          const headerLen = headerMatch[0].length;
          const tokenInWrap = value.slice(openIdx + 1 + headerLen, closeIdx).trim();
          const tokenText = value.slice(wrapStart, wrapEnd);
          if (tokenInWrap === tokenText) {
            const r = headerMatch[1].match(/^(-?\d+)(?:-(\d+))?$/);
            count = r ? Number(r[2] || r[1]) : 1;
            separator = headerMatch[2] || ", ";
            wrapStart = openIdx;
            wrapEnd = closeIdx + 1;
          }
        }
      }
    }
    return { count, separator, quantifier, wrapStart, wrapEnd };
  }, [token, value]);

  const [count, setCount] = useRTState(ctx.count);
  const [separator, setSeparator] = useRTState(ctx.separator);
  const [quantifier, setQuantifier] = useRTState(ctx.quantifier);

  useRTEffect(() => {
    setCount(ctx.count);
    setSeparator(ctx.separator);
    setQuantifier(ctx.quantifier);
  }, [token?.start, ctx.count, ctx.separator, ctx.quantifier]);

  useRTEffect(() => {
    const onDown = (e) => { if (!e.target.closest(".wp-tokenprops") && !e.target.closest(".wp-rt-var")) onClose(); };
    const onScroll = () => onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [onClose]);

  const apply = (nextCount, nextSep, nextQuant) => {
    const tokenText = "$" + token.meta.name;
    let replacement = tokenText;
    if (nextCount > 1) {
      replacement = (nextSep && nextSep !== ", ")
        ? `{${nextCount}$$${nextSep}$$${replacement}}`
        : `{${nextCount}$$${replacement}}`;
    }
    if (nextQuant > 1) replacement = `${nextQuant}#${replacement}`;
    const next = value.slice(0, ctx.wrapStart) + replacement + value.slice(ctx.wrapEnd);
    onChange(next);
  };

  const update = (patch) => {
    const next = { count, separator, quantifier, ...patch };
    setCount(next.count); setSeparator(next.separator); setQuantifier(next.quantifier);
    apply(next.count, next.separator, next.quantifier);
  };

  const emitted = (() => {
    let s = "$" + (token?.meta?.name || "");
    if (count > 1) {
      s = (separator && separator !== ", ")
        ? `{${count}$$${separator}$$${s}}`
        : `{${count}$$${s}}`;
    }
    if (quantifier > 1) s = `${quantifier}#${s}`;
    return s;
  })();

  if (!token || !rect) return null;

  const POP_W = 320;
  const left = Math.min(window.innerWidth - POP_W - 12, Math.max(12, rect.left));
  const top = Math.min(window.innerHeight - 360, rect.bottom + 6);

  return ReactDOM.createPortal(
    <div className="wp-tokenprops" style={{ left, top, width: POP_W }} onClick={(e) => e.stopPropagation()}>
      <div className="wp-tokenprops__head">
        <Icon name="pi-tag" style={{ fontSize: 11, color: "var(--wp-accent-text)" }} />
        <span className="wp-tokenprops__name">${token.meta.name}</span>
        <span className="wp-tokenprops__type">{optionInfo?.kind || "variable"}</span>
        <button type="button" className="wp-btn wp-btn--ghost wp-btn--sm wp-btn--icon" style={{ marginLeft: 4 }} onClick={onClose} title="Close">
          <Icon name="pi-times" />
        </button>
      </div>
      {optionInfo?.hint && (
        <div className="wp-dim" style={{ fontSize: 11.5, lineHeight: 1.4 }}>{optionInfo.hint}</div>
      )}

      <div className="wp-tokenprops__row">
        <span className="wp-tokenprops__label">Pick count</span>
        <div className="wp-hsplit" style={{ gap: 6 }}>
          <input type="number" min={1} max={20} value={count} onChange={(e) => update({ count: Math.max(1, Number(e.target.value) || 1) })} className="wp-input wp-input--sm" style={{ width: 64 }} />
          <span className="wp-dim" style={{ fontSize: 11 }}>{count > 1 ? `pick ${count} options` : "single value"}</span>
        </div>
      </div>

      <div className="wp-tokenprops__row" style={{ opacity: count > 1 ? 1 : 0.45 }}>
        <span className="wp-tokenprops__label">Separator</span>
        <input
          type="text"
          value={separator}
          onChange={(e) => update({ separator: e.target.value })}
          disabled={count <= 1}
          className="wp-input wp-input--sm"
          placeholder=", "
        />
      </div>

      <div className="wp-tokenprops__row">
        <span className="wp-tokenprops__label">Repeat</span>
        <div className="wp-hsplit" style={{ gap: 6 }}>
          <input type="number" min={1} max={20} value={quantifier} onChange={(e) => update({ quantifier: Math.max(1, Number(e.target.value) || 1) })} className="wp-input wp-input--sm" style={{ width: 64 }} />
          <span className="wp-dim" style={{ fontSize: 11 }}>{quantifier > 1 ? `resolve ${quantifier}× independently` : "no repeat"}</span>
        </div>
      </div>

      <div>
        <div className="wp-tokenprops__label" style={{ marginBottom: 4 }}>Emitted syntax</div>
        <div className="wp-tokenprops__output">{emitted}</div>
      </div>

      <div className="wp-tokenprops__legend">
        <Icon name="pi-info-circle" style={{ fontSize: 10 }} />
        Edits this reference in place using Impact-pack-style syntax.
      </div>
    </div>,
    document.body
  );
}

Object.assign(window, { RichTextInput, RichTextPreview, tokenizeRich, TokenPropsPopover });
