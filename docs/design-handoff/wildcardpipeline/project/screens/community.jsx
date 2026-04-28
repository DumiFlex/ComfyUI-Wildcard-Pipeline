/* global React, Icon, classNames, COMMUNITY, renderMD, useToasts, PageHeader, makeId */
const { useState, useEffect, useMemo, useRef } = React;

// ====================================================================
// Auth + API status — context provider
// ====================================================================
const CommunityCtx = React.createContext(null);

function CommunityProvider({ children, pushToast }) {
  // Persisted local state
  const initial = COMMUNITY.loadState();
  const [user, setUser]           = useState(initial.user || null);              // { id, handle, name, avatar, verified }
  const [installed, setInstalled] = useState(initial.installed || []);            // module ids
  const [stars, setStars]         = useState(initial.stars || []);                // module ids
  const [myUploads, setMyUploads] = useState(initial.myUploads || []);            // module ids
  const [installs, setInstalls]   = useState(initial.installs || []);             // [{id, at}]
  const [apiStatus, setApiStatus] = useState("online");                           // online | degraded | offline
  const [engineVersion]           = useState("1.4");

  // Persist on every change
  useEffect(() => {
    COMMUNITY.saveState({ user, installed, stars, myUploads, installs });
  }, [user, installed, stars, myUploads, installs]);

  // Periodic ping
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        await COMMUNITY.api.ping();
        if (!cancelled) setApiStatus("online");
      } catch {
        if (!cancelled) setApiStatus("offline");
      }
    };
    tick();
    const id = setInterval(tick, 12_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const signIn = () => {
    // Mock GitHub OAuth — in real life this opens a popup.
    const fake = {
      id: "u_me",
      handle: "you",
      name: "You",
      avatar: "🦄",
      verified: false,
    };
    setUser(fake);
    pushToast("Signed in with GitHub.");
  };
  const signOut = () => { setUser(null); pushToast("Signed out."); };

  const install = async (mod) => {
    try {
      await COMMUNITY.api.install(mod.id);
      setInstalled((prev) => prev.includes(mod.id) ? prev : [...prev, mod.id]);
      setInstalls((prev) => [{ id: mod.id, at: Date.now() }, ...prev.filter((x) => x.id !== mod.id)].slice(0, 50));
      pushToast(`Installed “${mod.name}”.`);
    } catch { pushToast("Couldn’t reach the registry. Try again."); }
  };
  const uninstall = async (mod) => {
    try {
      await COMMUNITY.api.uninstall(mod.id);
      setInstalled((prev) => prev.filter((x) => x !== mod.id));
      pushToast(`Removed “${mod.name}”.`);
    } catch { pushToast("Couldn’t reach the registry. Try again."); }
  };
  const toggleStar = async (mod) => {
    if (!user) { pushToast("Sign in to star modules."); return; }
    const willStar = !stars.includes(mod.id);
    try {
      await COMMUNITY.api.star(mod.id, willStar);
      setStars((prev) => willStar ? [...prev, mod.id] : prev.filter((x) => x !== mod.id));
    } catch { pushToast("Couldn’t reach the registry. Try again."); }
  };
  const publish = async (payload) => {
    if (!user) { pushToast("Sign in to publish."); return null; }
    try {
      const res = await COMMUNITY.api.publish(payload);
      setMyUploads((prev) => [res.id, ...prev]);
      pushToast(`Published “${payload.name}”.`);
      return res;
    } catch { pushToast("Publish failed — registry unreachable."); return null; }
  };

  const value = {
    user, signIn, signOut,
    apiStatus, setApiStatus,
    engineVersion,
    installed, install, uninstall,
    stars, toggleStar,
    myUploads, publish,
    installs,
  };
  return <CommunityCtx.Provider value={value}>{children}</CommunityCtx.Provider>;
}

const useCommunity = () => React.useContext(CommunityCtx);

// ====================================================================
// Topbar pill — auth state + API dot
// ====================================================================
function CommunityTopbarPill() {
  const c = useCommunity();
  if (!c) return null;
  const dot = c.apiStatus === "online" ? "var(--wp-success)" : c.apiStatus === "degraded" ? "var(--wp-warn)" : "var(--wp-danger)";
  return (
    <div className="wp-hsplit" style={{ gap: 8 }}>
      <div title={`Registry: ${c.apiStatus}`} className="wp-chip" style={{ paddingRight: 8 }}>
        <span style={{ width: 7, height: 7, borderRadius: 999, background: dot, display: "inline-block",
          boxShadow: c.apiStatus === "online" ? `0 0 6px ${dot}` : "none" }} />
        <span style={{ fontSize: 11, color: "var(--wp-text-muted)" }}>{c.apiStatus}</span>
      </div>
      {c.user ? (
        <button className="wp-btn wp-btn--sm" onClick={c.signOut} title={`Signed in as @${c.user.handle}`}>
          <span style={{ fontSize: 14 }}>{c.user.avatar}</span>
          <span>@{c.user.handle}</span>
        </button>
      ) : (
        <button className="wp-btn wp-btn--sm wp-btn--outline" onClick={c.signIn}>
          <Icon name="pi-github" />
          <span>Sign in</span>
        </button>
      )}
    </div>
  );
}

// ====================================================================
// Helpers
// ====================================================================
const fmtNum = (n) => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k" : String(n);
const relTime = (t) => {
  const d = Date.now() - t;
  const m = Math.floor(d / 60_000);
  if (m < 1)    return "just now";
  if (m < 60)   return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  const mo = Math.floor(days / 30);
  if (mo < 12)  return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
};
const KIND_LABEL = { wildcard: "Wildcard", fixed: "Fixed Values", combine: "Combine", derivation: "Derivation", constraint: "Constraint", pack: "Pack" };
const KIND_ICON  = { wildcard: "pi-th-large", fixed: "pi-tag", combine: "pi-share-alt", derivation: "pi-code", constraint: "pi-sitemap", pack: "pi-box" };

function Stars({ value, size = 12, onChange }) {
  const v = Math.round((value || 0) * 2) / 2; // half-step
  return (
    <span className="wp-hsplit" style={{ gap: 1 }}>
      {[1, 2, 3, 4, 5].map((i) => {
        const filled = v >= i;
        const half = !filled && v >= i - 0.5;
        return (
          <button key={i} type="button"
            onClick={onChange ? () => onChange(i) : undefined}
            disabled={!onChange}
            style={{ background: "none", border: "none", padding: 0, color: filled || half ? "#fbbf24" : "var(--wp-text-dim)",
              fontSize: size, lineHeight: 1, cursor: onChange ? "pointer" : "default" }}>
            <i className={"pi " + (filled ? "pi-star-fill" : half ? "pi-star-half-fill" : "pi-star")} />
          </button>
        );
      })}
    </span>
  );
}

function AuthorChip({ id, size = 14 }) {
  const a = COMMUNITY.authors.find((x) => x.id === id);
  if (!a) return null;
  return (
    <span className="wp-hsplit" style={{ gap: 6 }}>
      <span style={{
        width: size + 6, height: size + 6, borderRadius: 999,
        background: "var(--wp-bg-3)", border: "1px solid var(--wp-border)",
        display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: size,
      }}>{a.avatar}</span>
      <span style={{ fontSize: 12, color: "var(--wp-text-muted)" }}>@{a.handle}</span>
      {a.verified && <i className="pi pi-verified" title="Verified" style={{ color: "var(--wp-accent-text)", fontSize: 11 }} />}
    </span>
  );
}

// ====================================================================
// Module Card — used in Discover grid
// ====================================================================
function ModuleCard({ mod, onOpen }) {
  const c = useCommunity();
  const isInstalled = c.installed.includes(mod.id);
  const isStarred   = c.stars.includes(mod.id);
  const compatible  = COMMUNITY.engineSatisfies(c.engineVersion, mod.engineMin);
  return (
    <article className="wp-comm-card" onClick={() => onOpen(mod.id)} role="button" tabIndex={0}>
      <div className="wp-comm-card__hero" style={{ background: mod.hero }}>
        <span className="wp-comm-card__kind">
          <i className={"pi " + KIND_ICON[mod.kind]} /> {KIND_LABEL[mod.kind]}
        </span>
        {mod.nsfw && <span className="wp-comm-card__nsfw">18+</span>}
        {!compatible && <span className="wp-comm-card__incompat" title={`Needs engine ≥ ${mod.engineMin}`}>engine ≥ {mod.engineMin}</span>}
      </div>
      <div className="wp-comm-card__body">
        <div className="wp-comm-card__title-row">
          <h3 className="wp-comm-card__title">{mod.name}</h3>
          <button
            className="wp-comm-card__star"
            onClick={(e) => { e.stopPropagation(); c.toggleStar(mod); }}
            data-on={isStarred}
            title={isStarred ? "Unstar" : "Star"}
          >
            <i className={"pi " + (isStarred ? "pi-star-fill" : "pi-star")} />
          </button>
        </div>
        <p className="wp-comm-card__tagline">{mod.tagline}</p>
        <div className="wp-comm-card__author">
          <AuthorChip id={mod.author} />
          <span style={{ color: "var(--wp-text-dim)", fontSize: 11 }}>· {relTime(mod.updated)}</span>
        </div>
        <div className="wp-comm-card__stats">
          <span title="Downloads"><i className="pi pi-download" /> {fmtNum(mod.downloads)}</span>
          <span title="Stars"><i className="pi pi-star-fill" /> {fmtNum(mod.stars)}</span>
          <span title="Rating"><Stars value={mod.rating} size={11} /> <span style={{ color: "var(--wp-text-muted)", marginLeft: 2 }}>{mod.rating.toFixed(1)}</span></span>
        </div>
        <div className="wp-comm-card__tags">
          {mod.tags.slice(0, 4).map((t) => <span key={t} className="wp-chip" style={{ fontSize: 10, padding: "1px 6px" }}>{t}</span>)}
        </div>
        {isInstalled && (
          <div className="wp-comm-card__installed">
            <i className="pi pi-check-circle" /> Installed
          </div>
        )}
      </div>
    </article>
  );
}

// ====================================================================
// Discover screen
// ====================================================================
function CommunityDiscover({ onOpen, onUpload, onProfile }) {
  const c = useCommunity();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");
  const [tag, setTag] = useState(null);
  const [sort, setSort] = useState("trending");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [includeNsfw, setIncludeNsfw] = useState(false);
  const [compatibleOnly, setCompatibleOnly] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    COMMUNITY.api.list({ q, kind, tag, sort, verifiedOnly, includeNsfw, compatibleOnly, engine: c.engineVersion })
      .then((res) => { if (!cancelled) { setItems(res); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e.message || "error"); setLoading(false); } });
    return () => { cancelled = true; };
  }, [q, kind, tag, sort, verifiedOnly, includeNsfw, compatibleOnly, c.engineVersion]);

  const featured = useMemo(() =>
    COMMUNITY.FEATURED.map((id) => COMMUNITY.modules.find((m) => m.id === id)).filter(Boolean)
  , []);

  return (
    <div className="wp-page">
      <PageHeader
        title="Community"
        subtitle="Discover, install, and share modules with the rest of the pipeline."
        actions={
          <>
            <button className="wp-btn" onClick={onProfile}>
              <Icon name="pi-user" /><span>My profile</span>
            </button>
            <button className="wp-btn wp-btn--primary" onClick={onUpload}>
              <Icon name="pi-upload" /><span>Publish</span>
            </button>
          </>
        }
      />

      {/* Featured strip */}
      {featured.length > 0 && (
        <section className="wp-comm-featured">
          <div className="wp-comm-featured__head">
            <h2 className="wp-comm-featured__label"><i className="pi pi-bookmark-fill" /> Featured this week</h2>
            <span className="wp-comm-featured__hint">Curated by the team</span>
          </div>
          <div className="wp-comm-featured__row">
            {featured.map((m) => (
              <button key={m.id} className="wp-comm-feat" style={{ background: m.hero }} onClick={() => onOpen(m.id)}>
                <div className="wp-comm-feat__inner">
                  <span className="wp-chip" style={{ background: "rgba(0,0,0,0.4)", borderColor: "rgba(255,255,255,0.18)", color: "#fff" }}>
                    <i className={"pi " + KIND_ICON[m.kind]} /> {KIND_LABEL[m.kind]}
                  </span>
                  <h3>{m.name}</h3>
                  <p>{m.tagline}</p>
                  <div className="wp-comm-feat__stats">
                    <span><i className="pi pi-download" /> {fmtNum(m.downloads)}</span>
                    <span><i className="pi pi-star-fill" /> {fmtNum(m.stars)}</span>
                    <span><Stars value={m.rating} size={11} /></span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Filter bar */}
      <section className="wp-comm-filters">
        <div className="wp-input-group" style={{ flex: 1, minWidth: 200 }}>
          <i className="pi pi-search" />
          <input className="wp-input" placeholder="Search modules, tags, authors..." value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <button className="wp-btn wp-btn--ghost wp-btn--icon wp-btn--sm" onClick={() => setQ("")}><Icon name="pi-times" /></button>}
        </div>
        <select className="wp-input" style={{ width: 140 }} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="all">All kinds</option>
          <option value="wildcard">Wildcards</option>
          <option value="fixed">Fixed Values</option>
          <option value="combine">Combines</option>
          <option value="derivation">Derivations</option>
          <option value="constraint">Constraints</option>
          <option value="pack">Packs</option>
        </select>
        <select className="wp-input" style={{ width: 140 }} value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="trending">Trending</option>
          <option value="recent">Recently updated</option>
          <option value="downloads">Most downloaded</option>
          <option value="stars">Most starred</option>
          <option value="rating">Highest rated</option>
        </select>
        <label className="wp-comm-toggle"><input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} /> Verified only</label>
        <label className="wp-comm-toggle"><input type="checkbox" checked={compatibleOnly} onChange={(e) => setCompatibleOnly(e.target.checked)} /> Compatible (engine {c.engineVersion})</label>
        <label className="wp-comm-toggle wp-comm-toggle--nsfw"><input type="checkbox" checked={includeNsfw} onChange={(e) => setIncludeNsfw(e.target.checked)} /> Show 18+</label>
      </section>

      {/* Tag rail */}
      <div className="wp-comm-tagrail">
        <button className="wp-chip-btn" data-active={tag === null} onClick={() => setTag(null)}>All tags</button>
        {COMMUNITY.TAGS.slice(0, 14).map((t) => (
          <button key={t} className="wp-chip-btn" data-active={tag === t} onClick={() => setTag(tag === t ? null : t)}>{t}</button>
        ))}
      </div>

      {/* Body */}
      {error
        ? <CommunityOffline />
        : loading
          ? <CommunityGridSkeleton />
          : items.length === 0
            ? <CommunityEmpty q={q} onClear={() => { setQ(""); setKind("all"); setTag(null); }} />
            : (
              <div className="wp-comm-grid">
                {items.map((m) => <ModuleCard key={m.id} mod={m} onOpen={onOpen} />)}
              </div>
            )
      }
    </div>
  );
}

// ====================================================================
// Module Detail
// ====================================================================
function CommunityDetail({ id, onBack, onAuthor }) {
  const c = useCommunity();
  const [mod, setMod] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("readme");
  const [version, setVersion] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState({ rating: 5, text: "" });
  const [commentsLocal, setCommentsLocal] = useState([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    COMMUNITY.api.detail(id)
      .then((m) => { if (!cancelled) { setMod(m); setVersion(m.version); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e.code === 404 ? "404" : "offline"); setLoading(false); } });
  }, [id]);

  if (loading) return <DetailSkeleton onBack={onBack} />;
  if (error === "404") return <NotFound onBack={onBack} />;
  if (error) return <CommunityOffline />;

  const isInstalled = c.installed.includes(mod.id);
  const isStarred   = c.stars.includes(mod.id);
  const compatible  = COMMUNITY.engineSatisfies(c.engineVersion, mod.engineMin);
  const author = COMMUNITY.authors.find((a) => a.id === mod.author);

  const submitComment = async () => {
    if (!c.user) return;
    if (!commentDraft.text.trim()) return;
    const local = { author: c.user.id, text: commentDraft.text, rating: commentDraft.rating, at: Date.now(), me: true };
    setCommentsLocal((prev) => [local, ...prev]);
    setCommentDraft({ rating: 5, text: "" });
    try { await COMMUNITY.api.comment(mod.id, local.text, local.rating); } catch {}
  };

  const allComments = [...commentsLocal, ...mod.comments];

  return (
    <div className="wp-page">
      <button className="wp-btn wp-btn--ghost wp-btn--sm" onClick={onBack} style={{ marginBottom: 8, alignSelf: "flex-start" }}>
        <Icon name="pi-arrow-left" /><span>Back to Community</span>
      </button>

      {/* Hero */}
      <section className="wp-comm-detail-hero" style={{ background: mod.hero }}>
        <div className="wp-comm-detail-hero__inner">
          <div>
            <div className="wp-hsplit" style={{ gap: 8, marginBottom: 8 }}>
              <span className="wp-chip" style={{ background: "rgba(0,0,0,0.32)", borderColor: "rgba(255,255,255,0.18)", color: "#fff" }}>
                <i className={"pi " + KIND_ICON[mod.kind]} /> {KIND_LABEL[mod.kind]}
              </span>
              {mod.nsfw && <span className="wp-chip wp-chip--warn">18+</span>}
              {!compatible && <span className="wp-chip wp-chip--warn">needs engine ≥ {mod.engineMin}</span>}
            </div>
            <h1 className="wp-comm-detail-hero__title">{mod.name}</h1>
            <p className="wp-comm-detail-hero__tagline">{mod.tagline}</p>
            <div className="wp-comm-detail-hero__meta">
              <button className="wp-comm-detail-hero__author" onClick={() => onAuthor && onAuthor(mod.author)}>
                <span style={{ fontSize: 18 }}>{author?.avatar}</span>
                <span>@{author?.handle}</span>
                {author?.verified && <i className="pi pi-verified" style={{ color: "#fff" }} />}
              </button>
              <span>·</span>
              <span><i className="pi pi-clock" /> updated {relTime(mod.updated)}</span>
              <span>·</span>
              <span><i className="pi pi-bookmark" /> {mod.license}</span>
              <span>·</span>
              <span><i className="pi pi-cog" /> engine ≥ {mod.engineMin}</span>
            </div>
          </div>
          <div className="wp-comm-detail-hero__actions">
            {isInstalled
              ? <button className="wp-btn" onClick={() => c.uninstall(mod)}><Icon name="pi-check" /><span>Installed — Remove</span></button>
              : <button className="wp-btn wp-btn--primary" onClick={() => c.install(mod)} disabled={!compatible}>
                  <Icon name="pi-download" /><span>Install {mod.kind === "pack" ? "pack" : "module"}</span>
                </button>}
            <button className="wp-btn" onClick={() => c.toggleStar(mod)} data-active={isStarred}>
              <i className={"pi " + (isStarred ? "pi-star-fill" : "pi-star")} style={{ color: isStarred ? "#fbbf24" : undefined }} />
              <span>{isStarred ? "Starred" : "Star"} · {fmtNum(mod.stars + (isStarred ? 1 : 0))}</span>
            </button>
            <button className="wp-btn wp-btn--ghost" title="Report" onClick={() => setReportOpen(true)}>
              <Icon name="pi-flag" />
            </button>
          </div>
        </div>
      </section>

      {/* Stats strip */}
      <div className="wp-comm-detail-stats">
        <div><span>Downloads</span><strong>{fmtNum(mod.downloads)}</strong></div>
        <div><span>Stars</span><strong>{fmtNum(mod.stars + (isStarred ? 1 : 0))}</strong></div>
        <div><span>Rating</span><strong><Stars value={mod.rating} size={14} /> {mod.rating.toFixed(1)}<small style={{ color: "var(--wp-text-muted)", fontWeight: 400, marginLeft: 4 }}>({mod.ratings})</small></strong></div>
        <div><span>Versions</span><strong>{mod.versions}</strong></div>
        <div className="wp-comm-detail-stats__version">
          <span>Version</span>
          <select className="wp-input wp-input--sm" value={version} onChange={(e) => setVersion(e.target.value)}>
            {mod.changelog.map((cv) => <option key={cv.v} value={cv.v}>{cv.v} {cv.v === mod.version ? "(latest)" : ""}</option>)}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div className="wp-comm-tabs">
        {[["readme","README"],["preview","Preview"],["versions","Versions"],["reviews",`Reviews · ${allComments.length}`]].map(([k, label]) => (
          <button key={k} className="wp-comm-tab" data-active={tab === k} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {/* Tab body */}
      <div className="wp-comm-tabbody">
        {tab === "readme" && (
          <div className="wp-comm-readme" dangerouslySetInnerHTML={{ __html: renderMD(mod.readme) }} />
        )}
        {tab === "preview" && <PreviewTab mod={mod} />}
        {tab === "versions" && <VersionsTab mod={mod} version={version} setVersion={setVersion} />}
        {tab === "reviews" && (
          <ReviewsTab mod={mod}
            commentDraft={commentDraft} setCommentDraft={setCommentDraft}
            comments={allComments} onSubmit={submitComment} signedIn={!!c.user} />
        )}
      </div>

      {reportOpen && <ReportModal mod={mod} onClose={() => setReportOpen(false)} />}
    </div>
  );
}

// ----- Preview tab -----
function PreviewTab({ mod }) {
  if (mod.kind === "pack") {
    return (
      <div className="wp-comm-preview">
        <h3 style={{ margin: "0 0 8px 0" }}>What's in this pack</h3>
        <div className="wp-card wp-card__body" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
          {(mod.subKind || []).map((k) => (
            <div key={k} className="wp-pack-item">
              <i className={"pi " + KIND_ICON[k]} />
              <span>{KIND_LABEL[k]}</span>
            </div>
          ))}
        </div>
        <h3 style={{ margin: "16px 0 8px 0" }}>Sample resolutions</h3>
        <div className="wp-card wp-card__body">
          {(mod.previewVals || []).map((v, i) => (
            <div key={i} className="wp-comm-sample">{v}</div>
          ))}
        </div>
      </div>
    );
  }
  // Wildcard / fixed / etc — show options + histogram
  const total = (mod.options || []).reduce((s, o) => s + (o.weight || 0), 0) || 1;
  return (
    <div className="wp-comm-preview">
      <h3 style={{ margin: "0 0 8px 0" }}>Options & weight distribution</h3>
      <div className="wp-card wp-card__body">
        {(mod.options || []).map((o, i) => {
          const pct = (o.weight / total) * 100;
          return (
            <div key={i} className="wp-comm-histo-row">
              <span className="wp-comm-histo-row__val">{o.value}</span>
              <div className="wp-comm-histo-row__bar"><div style={{ width: pct + "%" }} /></div>
              <span className="wp-comm-histo-row__pct">{pct.toFixed(0)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ----- Versions tab -----
function VersionsTab({ mod, version, setVersion }) {
  return (
    <div className="wp-comm-versions">
      {mod.changelog.map((v) => (
        <div key={v.v} className="wp-comm-version" data-active={v.v === version}>
          <button className="wp-comm-version__head" onClick={() => setVersion(v.v)}>
            <span className="wp-comm-version__num">{v.v}{v.v === mod.version && <span className="wp-chip wp-chip--accent" style={{ marginLeft: 8 }}>latest</span>}</span>
            <span className="wp-comm-version__date">{relTime(v.at)}</span>
          </button>
          <p className="wp-comm-version__notes">{v.notes}</p>
        </div>
      ))}
    </div>
  );
}

// ----- Reviews tab -----
function ReviewsTab({ mod, commentDraft, setCommentDraft, comments, onSubmit, signedIn }) {
  const max = Math.max(...mod.ratingsDist, 1);
  return (
    <div className="wp-comm-reviews">
      <div className="wp-comm-reviews__summary">
        <div className="wp-comm-reviews__big">
          <div className="wp-comm-reviews__big-num">{mod.rating.toFixed(1)}</div>
          <Stars value={mod.rating} size={16} />
          <div style={{ color: "var(--wp-text-muted)", fontSize: 12, marginTop: 4 }}>{mod.ratings} reviews</div>
        </div>
        <div className="wp-comm-reviews__bars">
          {mod.ratingsDist.map((n, i) => (
            <div key={i} className="wp-comm-reviews__bar">
              <span style={{ width: 16 }}>{5 - i}★</span>
              <div className="wp-comm-reviews__bar-track"><div style={{ width: (n / max * 100) + "%" }} /></div>
              <span style={{ width: 36, textAlign: "right", color: "var(--wp-text-muted)" }}>{n}</span>
            </div>
          ))}
        </div>
      </div>

      {signedIn && (
        <div className="wp-card wp-card__body wp-comm-reviews__form">
          <div className="wp-hsplit" style={{ gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: "var(--wp-text-muted)" }}>Your rating</span>
            <Stars value={commentDraft.rating} onChange={(r) => setCommentDraft({ ...commentDraft, rating: r })} size={16} />
          </div>
          <textarea className="wp-input" rows={3} placeholder="Share your experience..." value={commentDraft.text} onChange={(e) => setCommentDraft({ ...commentDraft, text: e.target.value })} />
          <div className="wp-hsplit" style={{ justifyContent: "flex-end", marginTop: 8 }}>
            <button className="wp-btn wp-btn--primary" onClick={onSubmit} disabled={!commentDraft.text.trim()}>
              <Icon name="pi-send" /><span>Post review</span>
            </button>
          </div>
        </div>
      )}

      <div className="wp-comm-reviews__list">
        {comments.map((cm, i) => {
          const a = COMMUNITY.authors.find((x) => x.id === cm.author);
          return (
            <div key={i} className="wp-comm-review">
              <div className="wp-comm-review__head">
                <span style={{ fontSize: 18 }}>{cm.me ? "🦄" : a?.avatar}</span>
                <span style={{ fontWeight: 600 }}>{cm.me ? "You" : a?.name}</span>
                <span style={{ color: "var(--wp-text-muted)", fontSize: 12 }}>@{cm.me ? "you" : a?.handle}</span>
                <Stars value={cm.rating} size={12} />
                <span style={{ marginLeft: "auto", color: "var(--wp-text-dim)", fontSize: 12 }}>{relTime(cm.at)}</span>
              </div>
              <p className="wp-comm-review__text">{cm.text}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ----- Report modal -----
function ReportModal({ mod, onClose }) {
  const c = useCommunity();
  const [reason, setReason] = useState("inappropriate");
  const [notes, setNotes] = useState("");
  const submit = async () => {
    try { await COMMUNITY.api.report(mod.id, { reason, notes }); } catch {}
    onClose();
  };
  return (
    <div className="wp-modal-backdrop" onClick={onClose}>
      <div className="wp-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="wp-modal__head">
          <h3>Report module</h3>
          <button className="wp-btn wp-btn--ghost wp-btn--icon wp-btn--sm" onClick={onClose}><Icon name="pi-times" /></button>
        </div>
        <div className="wp-modal__body">
          <p style={{ color: "var(--wp-text-muted)", fontSize: 12, marginTop: 0 }}>Help keep the registry safe. Reports are reviewed by moderators within 48 hours.</p>
          <div className="wp-vsplit" style={{ gap: 6 }}>
            {[["inappropriate","Inappropriate or NSFW (mislabeled)"],
              ["malicious","Malicious or unsafe content"],
              ["copyright","Copyright violation"],
              ["spam","Spam / low quality"],
              ["other","Other"]].map(([k, label]) => (
              <label key={k} className="wp-radio-row">
                <input type="radio" name="report" checked={reason === k} onChange={() => setReason(k)} /> {label}
              </label>
            ))}
            <textarea className="wp-input" rows={3} placeholder="Additional notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <div className="wp-modal__foot">
          <button className="wp-btn" onClick={onClose}>Cancel</button>
          <button className="wp-btn wp-btn--danger" onClick={submit} disabled={!c.user}><Icon name="pi-flag" /><span>Submit report</span></button>
        </div>
      </div>
    </div>
  );
}

// ====================================================================
// Upload flow
// ====================================================================
function CommunityUpload({ onBack, onPublished }) {
  const c = useCommunity();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    atom: "single",       // single | pack
    kind: "wildcard",
    name: "",
    tagline: "",
    category: "subject",
    license: "MIT",
    engineMin: c.engineVersion,
    nsfw: false,
    tags: [],
    tagInput: "",
    readme: "",
    version: "1.0.0",
  });
  const [busy, setBusy] = useState(false);

  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const addTag = () => {
    const t = form.tagInput.trim().toLowerCase();
    if (t && !form.tags.includes(t)) update("tags", [...form.tags, t]);
    update("tagInput", "");
  };
  const removeTag = (t) => update("tags", form.tags.filter((x) => x !== t));

  const canPublish = form.name.trim() && form.tagline.trim() && form.tags.length > 0;

  const submit = async () => {
    setBusy(true);
    const res = await c.publish(form);
    setBusy(false);
    if (res) onPublished(res.id);
  };

  if (!c.user) {
    return (
      <div className="wp-page">
        <button className="wp-btn wp-btn--ghost wp-btn--sm" onClick={onBack} style={{ alignSelf: "flex-start", marginBottom: 8 }}>
          <Icon name="pi-arrow-left" /><span>Back</span>
        </button>
        <div className="wp-card wp-card__body" style={{ textAlign: "center", padding: 48 }}>
          <i className="pi pi-github" style={{ fontSize: 36, color: "var(--wp-text-muted)" }} />
          <h2 style={{ margin: "12px 0 4px 0" }}>Sign in to publish</h2>
          <p style={{ color: "var(--wp-text-muted)", margin: 0, maxWidth: 420, marginInline: "auto" }}>
            We use GitHub OAuth to verify uploaders. Your modules are tied to your GitHub identity.
          </p>
          <button className="wp-btn wp-btn--primary" style={{ marginTop: 16 }} onClick={c.signIn}>
            <Icon name="pi-github" /><span>Sign in with GitHub</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="wp-page">
      <button className="wp-btn wp-btn--ghost wp-btn--sm" onClick={onBack} style={{ alignSelf: "flex-start", marginBottom: 8 }}>
        <Icon name="pi-arrow-left" /><span>Back</span>
      </button>
      <PageHeader title="Publish to Community" subtitle="Share a module or pack with the registry. You can edit and version it later." />

      <div className="wp-comm-stepper">
        {["Atom","Details","Review"].map((label, i) => (
          <div key={label} className="wp-comm-step" data-active={step === i + 1} data-done={step > i + 1}>
            <span className="wp-comm-step__num">{step > i + 1 ? <i className="pi pi-check" /> : i + 1}</span>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <div className="wp-card wp-card__body">
        {step === 1 && (
          <div className="wp-vsplit" style={{ gap: 16 }}>
            <div>
              <h3 style={{ margin: "0 0 8px 0" }}>What are you publishing?</h3>
              <div className="wp-comm-atom-grid">
                <button className="wp-comm-atom" data-active={form.atom === "single"} onClick={() => update("atom", "single")}>
                  <i className="pi pi-th-large" />
                  <strong>Single module</strong>
                  <span>One Wildcard, Combine, Derivation, Constraint, or Fixed Values list.</span>
                </button>
                <button className="wp-comm-atom" data-active={form.atom === "pack"} onClick={() => update("atom", "pack")}>
                  <i className="pi pi-box" />
                  <strong>Module pack</strong>
                  <span>A bundle of related modules — like a full pipeline preset.</span>
                </button>
              </div>
            </div>

            {form.atom === "single" && (
              <div>
                <label className="wp-label">Module kind</label>
                <select className="wp-input" value={form.kind} onChange={(e) => update("kind", e.target.value)} style={{ maxWidth: 240 }}>
                  <option value="wildcard">Wildcard</option>
                  <option value="fixed">Fixed Values</option>
                  <option value="combine">Combine</option>
                  <option value="derivation">Derivation</option>
                  <option value="constraint">Constraint</option>
                </select>
              </div>
            )}

            <div className="wp-hsplit" style={{ justifyContent: "flex-end" }}>
              <button className="wp-btn wp-btn--primary" onClick={() => setStep(2)}>Next<Icon name="pi-arrow-right" /></button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="wp-comm-form">
            <div className="wp-comm-form__row">
              <label className="wp-label">Name *</label>
              <input className="wp-input" value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="Hair Color Pro" />
            </div>
            <div className="wp-comm-form__row">
              <label className="wp-label">Tagline *</label>
              <input className="wp-input" value={form.tagline} onChange={(e) => update("tagline", e.target.value)} placeholder="One sentence about what this does." />
            </div>
            <div className="wp-comm-form__row wp-comm-form__row--split">
              <div>
                <label className="wp-label">Category</label>
                <select className="wp-input" value={form.category} onChange={(e) => update("category", e.target.value)}>
                  {["subject","outfit","scene","lighting","style","camera","weather","misc"].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="wp-label">License</label>
                <select className="wp-input" value={form.license} onChange={(e) => update("license", e.target.value)}>
                  <option>MIT</option><option>CC0</option><option>CC-BY</option><option>CC-BY-NC</option><option>Proprietary</option>
                </select>
              </div>
              <div>
                <label className="wp-label">Min engine</label>
                <input className="wp-input" value={form.engineMin} onChange={(e) => update("engineMin", e.target.value)} />
              </div>
              <div>
                <label className="wp-label">Version</label>
                <input className="wp-input" value={form.version} onChange={(e) => update("version", e.target.value)} />
              </div>
            </div>
            <div className="wp-comm-form__row">
              <label className="wp-label">Tags *</label>
              <div className="wp-input-group">
                <input className="wp-input" value={form.tagInput} onChange={(e) => update("tagInput", e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                  placeholder="portrait, fashion, vibrant..." />
                <button className="wp-btn wp-btn--sm" onClick={addTag}>Add</button>
              </div>
              {form.tags.length > 0 && (
                <div className="wp-hsplit" style={{ flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                  {form.tags.map((t) => (
                    <span key={t} className="wp-chip">{t}<button onClick={() => removeTag(t)} style={{ background: "none", border: "none", padding: 0, marginLeft: 4, color: "inherit", cursor: "pointer" }}><i className="pi pi-times" style={{ fontSize: 10 }} /></button></span>
                  ))}
                </div>
              )}
            </div>
            <div className="wp-comm-form__row">
              <label className="wp-label">README (Markdown)</label>
              <textarea className="wp-input wp-input--mono" rows={8} value={form.readme} onChange={(e) => update("readme", e.target.value)} placeholder={"# What's inside\n\nDescribe the module..."} />
            </div>
            <div className="wp-comm-form__row">
              <label className="wp-comm-toggle"><input type="checkbox" checked={form.nsfw} onChange={(e) => update("nsfw", e.target.checked)} /> Mark as 18+ (NSFW)</label>
            </div>
            <div className="wp-hsplit" style={{ justifyContent: "space-between" }}>
              <button className="wp-btn" onClick={() => setStep(1)}><Icon name="pi-arrow-left" />Back</button>
              <button className="wp-btn wp-btn--primary" onClick={() => setStep(3)} disabled={!canPublish}>Review<Icon name="pi-arrow-right" /></button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="wp-comm-review-step">
            <h3 style={{ margin: "0 0 8px 0" }}>Review before publishing</h3>
            <div className="wp-comm-review-grid">
              <div><span>Kind</span><strong>{form.atom === "pack" ? "Pack" : KIND_LABEL[form.kind]}</strong></div>
              <div><span>Name</span><strong>{form.name}</strong></div>
              <div><span>Tagline</span><strong>{form.tagline}</strong></div>
              <div><span>Category</span><strong>{form.category}</strong></div>
              <div><span>License</span><strong>{form.license}</strong></div>
              <div><span>Engine</span><strong>≥ {form.engineMin}</strong></div>
              <div><span>Version</span><strong>{form.version}</strong></div>
              <div><span>NSFW</span><strong>{form.nsfw ? "Yes" : "No"}</strong></div>
              <div style={{ gridColumn: "1 / -1" }}><span>Tags</span><strong>{form.tags.join(", ")}</strong></div>
            </div>
            <p style={{ color: "var(--wp-text-muted)", fontSize: 12 }}>By publishing, you agree to the registry's content guidelines. You can edit metadata or unpublish at any time from your profile.</p>
            <div className="wp-hsplit" style={{ justifyContent: "space-between" }}>
              <button className="wp-btn" onClick={() => setStep(2)}><Icon name="pi-arrow-left" />Back</button>
              <button className="wp-btn wp-btn--primary" onClick={submit} disabled={busy}>
                {busy ? <><i className="pi pi-spin pi-spinner" /><span>Publishing...</span></> : <><Icon name="pi-upload" /><span>Publish</span></>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ====================================================================
// Profile
// ====================================================================
function CommunityProfile({ onBack, onOpen, onUpload }) {
  const c = useCommunity();
  const [tab, setTab] = useState("uploads");

  if (!c.user) {
    return (
      <div className="wp-page">
        <button className="wp-btn wp-btn--ghost wp-btn--sm" onClick={onBack} style={{ alignSelf: "flex-start", marginBottom: 8 }}>
          <Icon name="pi-arrow-left" /><span>Back</span>
        </button>
        <div className="wp-card wp-card__body" style={{ textAlign: "center", padding: 48 }}>
          <i className="pi pi-user" style={{ fontSize: 36, color: "var(--wp-text-muted)" }} />
          <h2 style={{ margin: "12px 0 4px 0" }}>Sign in to view your profile</h2>
          <button className="wp-btn wp-btn--primary" style={{ marginTop: 16 }} onClick={c.signIn}>
            <Icon name="pi-github" /><span>Sign in with GitHub</span>
          </button>
        </div>
      </div>
    );
  }

  const starredMods   = c.stars.map((id) => COMMUNITY.modules.find((m) => m.id === id)).filter(Boolean);
  const installedMods = c.installed.map((id) => COMMUNITY.modules.find((m) => m.id === id)).filter(Boolean);
  // Synthesize uploads from myUploads (publish ids) — for the demo we just preview a single fake upload card
  const myUploads = c.myUploads.map((id) => ({
    id, name: "My Module — " + id.slice(-4).toUpperCase(),
    tagline: "Just published. Awaiting moderation review.",
    kind: "wildcard", category: "misc", tags: ["draft"], downloads: 0, stars: 0, rating: 0, ratings: 0,
    version: "1.0.0", versions: 1, updated: Date.now(), created: Date.now(),
    nsfw: false, license: "MIT", engineMin: c.engineVersion, author: "u_me",
    hero: "linear-gradient(135deg, var(--wp-accent-600) 0%, var(--wp-accent-800) 100%)",
  }));

  return (
    <div className="wp-page">
      <button className="wp-btn wp-btn--ghost wp-btn--sm" onClick={onBack} style={{ alignSelf: "flex-start", marginBottom: 8 }}>
        <Icon name="pi-arrow-left" /><span>Back to Community</span>
      </button>

      <section className="wp-comm-profile-hero">
        <div className="wp-comm-profile-avatar">{c.user.avatar}</div>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0 }}>{c.user.name}</h1>
          <div style={{ color: "var(--wp-text-muted)" }}>@{c.user.handle} · joined just now</div>
          <div className="wp-comm-profile-stats">
            <div><strong>{myUploads.length}</strong><span>Uploads</span></div>
            <div><strong>{c.stars.length}</strong><span>Stars</span></div>
            <div><strong>{c.installed.length}</strong><span>Installed</span></div>
            <div><strong>{c.installs.length}</strong><span>Install history</span></div>
          </div>
        </div>
        <div className="wp-hsplit" style={{ gap: 8 }}>
          <button className="wp-btn wp-btn--primary" onClick={onUpload}><Icon name="pi-upload" /><span>Publish</span></button>
          <button className="wp-btn" onClick={c.signOut}><Icon name="pi-sign-out" /><span>Sign out</span></button>
        </div>
      </section>

      <div className="wp-comm-tabs" style={{ marginTop: 16 }}>
        {[["uploads", `My uploads · ${myUploads.length}`],
          ["stars",   `Starred · ${starredMods.length}`],
          ["installed", `Installed · ${installedMods.length}`],
          ["history", `History · ${c.installs.length}`]].map(([k, label]) => (
          <button key={k} className="wp-comm-tab" data-active={tab === k} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      <div className="wp-comm-tabbody">
        {tab === "uploads" && (
          myUploads.length === 0
            ? <ProfileEmpty title="You haven't published anything yet." cta="Publish a module" onCta={onUpload} icon="pi-upload" />
            : <div className="wp-comm-grid">{myUploads.map((m) => <ModuleCard key={m.id} mod={m} onOpen={() => {}} />)}</div>
        )}
        {tab === "stars" && (
          starredMods.length === 0
            ? <ProfileEmpty title="No starred modules yet." subtitle="Star modules to save them for later." icon="pi-star" />
            : <div className="wp-comm-grid">{starredMods.map((m) => <ModuleCard key={m.id} mod={m} onOpen={onOpen} />)}</div>
        )}
        {tab === "installed" && (
          installedMods.length === 0
            ? <ProfileEmpty title="No modules installed from the registry." subtitle="Browse Community to find some." icon="pi-download" />
            : <div className="wp-comm-grid">{installedMods.map((m) => <ModuleCard key={m.id} mod={m} onOpen={onOpen} />)}</div>
        )}
        {tab === "history" && (
          c.installs.length === 0
            ? <ProfileEmpty title="No install history yet." icon="pi-clock" />
            : (
              <div className="wp-card wp-card__body">
                <table className="wp-table">
                  <thead><tr><th>Module</th><th>Installed</th><th></th></tr></thead>
                  <tbody>
                    {c.installs.map((it) => {
                      const m = COMMUNITY.modules.find((x) => x.id === it.id);
                      if (!m) return null;
                      return (
                        <tr key={it.id + it.at}>
                          <td><button className="wp-link" onClick={() => onOpen(m.id)}>{m.name}</button></td>
                          <td style={{ color: "var(--wp-text-muted)" }}>{relTime(it.at)}</td>
                          <td style={{ textAlign: "right" }}>
                            <button className="wp-btn wp-btn--sm wp-btn--ghost" onClick={() => onOpen(m.id)}>Open</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
        )}
      </div>
    </div>
  );
}

function ProfileEmpty({ title, subtitle, cta, onCta, icon }) {
  return (
    <div className="wp-empty" style={{ padding: 48, textAlign: "center" }}>
      <i className={"pi " + (icon || "pi-inbox")} style={{ fontSize: 32, color: "var(--wp-text-dim)" }} />
      <h3 style={{ margin: "8px 0 4px 0" }}>{title}</h3>
      {subtitle && <p style={{ color: "var(--wp-text-muted)", margin: 0 }}>{subtitle}</p>}
      {cta && <button className="wp-btn wp-btn--primary" style={{ marginTop: 12 }} onClick={onCta}>{cta}</button>}
    </div>
  );
}

// ====================================================================
// Error / loading states
// ====================================================================
function CommunityOffline() {
  const c = useCommunity();
  return (
    <div className="wp-empty" style={{ padding: 48, textAlign: "center" }}>
      <i className="pi pi-wifi" style={{ fontSize: 36, color: "var(--wp-danger)" }} />
      <h3 style={{ margin: "8px 0 4px 0" }}>Registry unreachable</h3>
      <p style={{ color: "var(--wp-text-muted)", margin: 0, maxWidth: 480, marginInline: "auto" }}>
        We couldn't reach the community API. Check your internet connection or try again in a moment.
      </p>
      <div className="wp-hsplit" style={{ justifyContent: "center", marginTop: 16, gap: 8 }}>
        <button className="wp-btn wp-btn--primary" onClick={() => COMMUNITY.api.ping().then(() => c.setApiStatus("online")).catch(() => c.setApiStatus("offline"))}>
          <Icon name="pi-refresh" /><span>Retry</span>
        </button>
        <button className="wp-btn" onClick={() => { COMMUNITY.setApiOnline(true); c.setApiStatus("online"); }}>
          <Icon name="pi-check" /><span>Force online (demo)</span>
        </button>
      </div>
    </div>
  );
}
function NotFound({ onBack }) {
  return (
    <div className="wp-empty" style={{ padding: 64, textAlign: "center" }}>
      <div style={{ fontSize: 88, fontWeight: 700, color: "var(--wp-accent-text)", lineHeight: 1 }}>404</div>
      <h3 style={{ margin: "8px 0 4px 0" }}>Module not found</h3>
      <p style={{ color: "var(--wp-text-muted)", margin: 0 }}>It might have been unpublished, renamed, or moved.</p>
      <button className="wp-btn wp-btn--primary" style={{ marginTop: 16 }} onClick={onBack}><Icon name="pi-arrow-left" /><span>Back to Community</span></button>
    </div>
  );
}
function CommunityEmpty({ q, onClear }) {
  return (
    <div className="wp-empty" style={{ padding: 48, textAlign: "center" }}>
      <i className="pi pi-search" style={{ fontSize: 32, color: "var(--wp-text-dim)" }} />
      <h3 style={{ margin: "8px 0 4px 0" }}>{q ? `No matches for “${q}”` : "Nothing to show"}</h3>
      <p style={{ color: "var(--wp-text-muted)", margin: 0 }}>Try clearing filters or broaden your search.</p>
      <button className="wp-btn" style={{ marginTop: 12 }} onClick={onClear}><Icon name="pi-filter-slash" /><span>Clear filters</span></button>
    </div>
  );
}
function CommunityGridSkeleton() {
  return (
    <div className="wp-comm-grid">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="wp-comm-card wp-comm-card--skeleton">
          <div className="wp-comm-card__hero" style={{ background: "var(--wp-bg-2)" }} />
          <div className="wp-comm-card__body">
            <div className="wp-skel" style={{ width: "70%", height: 14 }} />
            <div className="wp-skel" style={{ width: "100%", height: 10, marginTop: 8 }} />
            <div className="wp-skel" style={{ width: "55%", height: 10, marginTop: 4 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
function DetailSkeleton({ onBack }) {
  return (
    <div className="wp-page">
      <button className="wp-btn wp-btn--ghost wp-btn--sm" onClick={onBack} style={{ marginBottom: 8, alignSelf: "flex-start" }}>
        <Icon name="pi-arrow-left" /><span>Back</span>
      </button>
      <div className="wp-skel" style={{ height: 200, borderRadius: 12 }} />
      <div className="wp-skel" style={{ height: 80, marginTop: 12, borderRadius: 8 }} />
      <div className="wp-skel" style={{ height: 240, marginTop: 12, borderRadius: 8 }} />
    </div>
  );
}

// ====================================================================
// Wrapper screen — handles internal routing
// ====================================================================
function CommunityScreen() {
  const [view, setView] = useState({ name: "discover" });
  return (
    <>
      {view.name === "discover" && <CommunityDiscover
        onOpen={(id) => setView({ name: "detail", id })}
        onUpload={() => setView({ name: "upload" })}
        onProfile={() => setView({ name: "profile" })}
      />}
      {view.name === "detail" && <CommunityDetail
        id={view.id}
        onBack={() => setView({ name: "discover" })}
      />}
      {view.name === "upload" && <CommunityUpload
        onBack={() => setView({ name: "discover" })}
        onPublished={() => setView({ name: "profile" })}
      />}
      {view.name === "profile" && <CommunityProfile
        onBack={() => setView({ name: "discover" })}
        onOpen={(id) => setView({ name: "detail", id })}
        onUpload={() => setView({ name: "upload" })}
      />}
    </>
  );
}

Object.assign(window, { CommunityProvider, CommunityTopbarPill, CommunityScreen, useCommunity });
