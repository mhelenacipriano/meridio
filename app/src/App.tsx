import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import {
  ArrowLeft, Bell, Bookmark, Copy, ExternalLink, Moon, PanelRight, Search,
  SlidersHorizontal, Sun, X,
} from 'lucide-react';
import { COUNTRIES, JOBS, ROLES, SEN } from './data';
import type { Job } from './data';
import { T } from './i18n';
import type { Lang, Strings } from './i18n';

type Theme = 'light' | 'dark';
type View = 'jobs' | 'saved';
type Posted = 'any' | 'd1' | 'd7' | 'd30';

const MOBILE_BP = 860;
const MAX_HOURS: Record<Posted, number> = { any: Infinity, d1: 24, d7: 168, d30: 720 };

/* ---------- storage helpers (always safe) ---------- */
const store = {
  get(k: string): string | null {
    try { return window.localStorage.getItem('meridio.' + k); } catch { return null; }
  },
  set(k: string, v: unknown) {
    try { window.localStorage.setItem('meridio.' + k, typeof v === 'string' ? v : JSON.stringify(v)); } catch { /* ignore */ }
  },
};

function initialLang(): Lang {
  const s = store.get('lang');
  if (s === 'es' || s === 'pt' || s === 'en') return s;
  const n = navigator.language || '';
  return n.startsWith('pt') ? 'pt' : n.startsWith('en') ? 'en' : 'es';
}
function initialTheme(): Theme {
  const s = store.get('theme');
  if (s === 'light' || s === 'dark') return s;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function initialSaved(): number[] {
  try {
    const v = JSON.parse(store.get('saved') || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'number') : [];
  } catch { return []; }
}

/* ---------- filters mirrored into the URL ---------- */
interface Filters { q: string; roles: string[]; sens: string[]; country: string; posted: Posted }
const EMPTY: Filters = { q: '', roles: [], sens: [], country: 'all', posted: 'any' };

function filtersFromUrl(): Filters {
  const p = new URLSearchParams(window.location.search);
  const list = (k: string, valid: string[]) => (p.get(k) || '').split(',').filter((x) => valid.includes(x));
  const country = p.get('country') || 'all';
  const posted = (p.get('posted') || 'any') as Posted;
  return {
    q: p.get('q') || '',
    roles: list('role', ROLES.map((r) => r[0])),
    sens: list('sen', SEN),
    country: country === 'all' || COUNTRIES.some((c) => c[0] === country) ? country : 'all',
    posted: posted in MAX_HOURS ? posted : 'any',
  };
}
function filtersToUrl(f: Filters) {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.roles.length) p.set('role', f.roles.join(','));
  if (f.sens.length) p.set('sen', f.sens.join(','));
  if (f.country !== 'all') p.set('country', f.country);
  if (f.posted !== 'any') p.set('posted', f.posted);
  const qs = p.toString();
  window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
}

/* ---------- small helpers ---------- */
const cname = (code: string) => (COUNTRIES.find((c) => c[0] === code) || [code, code])[1];
const domain = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const rel = (h: number, t: Strings) => (h < 1 ? t.now : t.ago(h < 24 ? h + ' h' : Math.round(h / 24) + ' d'));
const eligText = (j: Job, t: Strings) => (j.c.includes('LATAM') ? t.latam : j.c.map(cname).join(', '));

function useIsMobile() {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w < MOBILE_BP;
}

const ico = { strokeWidth: 2 } as const;

/* ---------- App ---------- */
export default function App() {
  const mob = useIsMobile();
  const [lang, setLang] = useState<Lang>(initialLang);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [view, setView] = useState<View>('jobs');
  const [filters, setFilters] = useState<Filters>(filtersFromUrl);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [panelHidden, setPanelHidden] = useState(() => store.get('panel') === 'hidden');
  const [saved, setSaved] = useState<number[]>(initialSaved);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertSent, setAlertSent] = useState(false);
  const [email, setEmail] = useState('');
  const [toast, setToast] = useState('');
  const toastTimer = useRef<number>();

  const t = T[lang];
  const { q, roles, sens, country, posted } = filters;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.lang = lang;
  }, [theme, lang]);
  useEffect(() => filtersToUrl(filters), [filters]);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const patch = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p }));
  const toggleIn = (key: 'roles' | 'sens', v: string) =>
    setFilters((f) => ({ ...f, [key]: f[key].includes(v) ? f[key].filter((x) => x !== v) : [...f[key], v] }));
  const clearFilters = () => setFilters(EMPTY);

  const showToast = useCallback((msg: string) => {
    window.clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = window.setTimeout(() => setToast(''), 1800);
  }, []);

  const toggleSave = (id: number) => {
    const on = saved.includes(id);
    const next = on ? saved.filter((x) => x !== id) : [...saved, id];
    store.set('saved', next);
    setSaved(next);
    showToast(on ? t.removedToast : t.savedToast);
  };
  const setPanel = (hidden: boolean) => { store.set('panel', hidden ? 'hidden' : 'shown'); setPanelHidden(hidden); };

  const qn = q.trim().toLowerCase();
  const filtered = useMemo(
    () => JOBS.filter((j) =>
      (!qn || [j.title, j.company, ...j.stack].join(' ').toLowerCase().includes(qn)) &&
      (!roles.length || roles.includes(j.role)) &&
      (!sens.length || sens.includes(j.sen)) &&
      (country === 'all' || j.c.includes('LATAM') || j.c.includes(country)) &&
      j.h <= MAX_HOURS[posted]).sort((a, b) => a.h - b.h),
    [qn, roles, sens, country, posted],
  );
  const savedJobs = useMemo(() => JOBS.filter((j) => saved.includes(j.id)), [saved]);
  const isSavedView = view === 'saved';
  const list = isSavedView ? savedJobs : filtered;

  let sel = JOBS.find((j) => j.id === selectedId);
  if (!mob && (!sel || !list.includes(sel))) sel = list[0];

  const nFilters = roles.length + sens.length + (country !== 'all' ? 1 : 0) + (posted !== 'any' ? 1 : 0) + (qn ? 1 : 0);
  const showDetail = mob ? detailOpen && !!sel : !panelHidden;
  const showList = !mob || !showDetail;

  /* keyboard: arrows move selection, Esc hides the panel (desktop only) */
  const kb = useRef({ list, sel, mob, alertOpen, sheetOpen, panelHidden });
  kb.current = { list, sel, mob, alertOpen, sheetOpen, panelHidden };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = kb.current;
      if (s.mob || s.alertOpen) return;
      if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '')) return;
      if (e.key === 'Escape' && !s.sheetOpen && !s.panelHidden) { setPanel(true); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if (!s.list.length) return;
      e.preventDefault();
      const i = Math.max(0, s.list.findIndex((j) => j.id === s.sel?.id));
      const n = e.key === 'ArrowDown' ? Math.min(s.list.length - 1, i + 1) : Math.max(0, i - 1);
      setSelectedId(s.list[n].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const selectJob = (id: number) => {
    if (!mob && panelHidden) store.set('panel', 'shown');
    setSelectedId(id); setDetailOpen(true); setPanelHidden(false);
  };
  const goView = (v: View) => { setView(v); setDetailOpen(false); setSelectedId(null); };
  const openAlert = () => { setAlertOpen(true); setAlertSent(false); setSheetOpen(false); };

  const summaryBits = [
    ...roles.map((r) => ROLES.find((x) => x[0] === r)?.[1]),
    ...sens.map((x) => t.sen[x as keyof Strings['sen']]),
    country !== 'all' ? cname(country) : null,
    qn ? '“' + q.trim() + '”' : null,
  ].filter(Boolean) as string[];
  const emailInvalid = !/^\S+@\S+\.\S+$/.test(email);

  const tabs: { v: View; label: string; count: number }[] = [
    { v: 'jobs', label: t.jobs, count: 0 },
    { v: 'saved', label: t.saved, count: saved.length },
  ];
  const TabButtons = () => (
    <>
      {tabs.map((tab) => (
        <button key={tab.v} className="tab" aria-current={view === tab.v ? 'page' : 'false'} onClick={() => goView(tab.v)}>
          <span>{tab.label}</span>
          {tab.count > 0 && <span className="badge">{tab.count}</span>}
        </button>
      ))}
    </>
  );

  const chipGroup = (label: string, items: [string, string][], on: string[], key: 'roles' | 'sens') => (
    <div className="chip-group" role="group" aria-label={label}>
      <span className="label-caps">{label}</span>
      {items.map(([k, l]) => (
        <button key={k} className="chip" aria-pressed={on.includes(k)} onClick={() => toggleIn(key, k)}>{l}</button>
      ))}
    </div>
  );
  const roleItems = ROLES;
  const senItems: [string, string][] = SEN.map((k) => [k, t.sen[k]]);

  const countryOpts = [['all', t.anyCountry], ...COUNTRIES] as [string, string][];
  const postedOpts: [string, string][] = [['any', t.anyTime], ['d1', t.d1], ['d7', t.d7], ['d30', t.d30]];
  const selects = (cls: string) => (
    <>
      <label className="field">
        <span>{t.country}</span>
        <select className={'select country ' + cls} value={country} onChange={(e) => patch({ country: e.target.value })}>
          {countryOpts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className="field">
        <span>{t.posted}</span>
        <select className={'select ' + cls} value={posted} onChange={(e) => patch({ posted: e.target.value as Posted })}>
          {postedOpts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
    </>
  );

  const searchBox = (placeholder: string) => (
    <label className="search">
      <Search size={16} {...ico} aria-hidden="true" />
      <input type="search" value={q} onChange={(e) => patch({ q: e.target.value })} placeholder={placeholder} aria-label={t.search} />
    </label>
  );

  const listTitle = isSavedView ? t.savedTitle(savedJobs.length) : t.count(filtered.length);
  const compactCls = ''; // density tweak from the prototype; comfortable by default
  const toastBottom = mob ? (showDetail ? 84 : 72) : 20;

  return (
    <div className={'app ' + (mob ? 'mobile ' : '') + compactCls}>
      <header className="header">
        <a className="brand" href="/" onClick={(e) => { e.preventDefault(); setView('jobs'); setDetailOpen(false); }}>
          <span className="brand-mark" />
          <span className="brand-name">meridio</span>
          {!mob && <span className="brand-tag">{t.tagline}</span>}
        </a>
        {!mob && <nav className="nav">{TabButtons()}</nav>}
        <div className="lang" role="group" aria-label="Language">
          {(['es', 'pt', 'en'] as Lang[]).map((l) => (
            <button key={l} aria-pressed={lang === l} onClick={() => { store.set('lang', l); setLang(l); }}>{l.toUpperCase()}</button>
          ))}
        </div>
        <button
          className="icon-btn theme-btn"
          aria-label={theme === 'dark' ? t.light : t.dark}
          title={theme === 'dark' ? t.light : t.dark}
          onClick={() => { const n = theme === 'dark' ? 'light' : 'dark'; store.set('theme', n); setTheme(n); }}
        >
          {theme === 'dark' ? <Sun size={18} {...ico} /> : <Moon size={18} {...ico} />}
        </button>
      </header>

      {!mob && !isSavedView && (
        <div className="toolbar">
          <div className="toolbar-row">
            {searchBox(t.search)}
            {selects('')}
            <button className="btn-secondary" onClick={openAlert}><Bell size={16} {...ico} /><span>{t.alerts}</span></button>
          </div>
          <div className="chip-rows">
            {chipGroup(t.role, roleItems, roles, 'roles')}
            {chipGroup(t.seniority, senItems, sens, 'sens')}
            {nFilters > 0 && <button className="link-btn" onClick={clearFilters}>{t.clear}</button>}
          </div>
        </div>
      )}

      <main className={'main' + (mob || panelHidden ? ' single' : '')}>
        {showList && (
          <section className="pane" aria-label={listTitle}>
            {mob && !isSavedView && (
              <div className="mobile-search">
                {searchBox(t.searchShort)}
                <button className={'filter-btn' + (nFilters ? ' on' : '')} onClick={() => setSheetOpen(true)}>
                  <SlidersHorizontal size={16} {...ico} />
                  <span>{nFilters ? t.filters + ' · ' + nFilters : t.filters}</span>
                </button>
              </div>
            )}
            <div className="list-head">
              <h2>{listTitle}</h2>
              <span className="list-sub">{isSavedView ? t.savedSub : t.newest}</span>
              {!mob && list.length > 0 && (
                <button className="panel-toggle" aria-pressed={!panelHidden} title={panelHidden ? t.showDetails : t.hideDetails} onClick={() => setPanel(!panelHidden)}>
                  <PanelRight size={15} {...ico} />
                  <span>{panelHidden ? t.showDetails : t.hideDetails}</span>
                </button>
              )}
            </div>
            <div className={'cards' + (!mob && panelHidden ? ' wide' : '')}>
              {list.map((j) => {
                const on = !!sel && sel.id === j.id && !mob && !panelHidden;
                const sv = saved.includes(j.id);
                const stop = (e: MouseEvent) => e.stopPropagation();
                return (
                  <article key={j.id} className={'card' + (on ? ' selected' : '')} onClick={() => selectJob(j.id)}>
                    <div className="logo sm" aria-hidden="true">{j.ini}</div>
                    <div className="card-body">
                      <div className="card-top">
                        <div>
                          <button className="card-title" aria-current={on} onClick={(e) => { stop(e); selectJob(j.id); }}>{j.title}</button>
                          <div className="card-sub">{j.company} · {eligText(j, t)} · {t[j.ct]}</div>
                        </div>
                        <button
                          className="save-btn" aria-pressed={sv} aria-label={sv ? t.unsaveJob : t.saveJob} title={sv ? t.unsaveJob : t.saveJob}
                          onClick={(e) => { stop(e); toggleSave(j.id); }}
                        >
                          <Bookmark size={18} strokeWidth={2} strokeLinejoin="round" />
                        </button>
                      </div>
                      <div className="tags">
                        <span className="pill sen">{t.sen[j.sen]}</span>
                        {j.stack.slice(0, 3).map((s) => <span key={s} className="pill">{s}</span>)}
                      </div>
                      <div className="card-foot">
                        {j.h < 24 && <span className="new">{t.newTag}</span>}
                        <span className="muted">{rel(j.h, t)}</span>
                        {j.pay && <span style={{ fontWeight: 600 }}>{j.pay}</span>}
                        <a
                          className="quick-apply" href={j.url} target="_blank" rel="noopener noreferrer" onClick={stop}
                          aria-label={t.applyOn(domain(j.url)) + ' — ' + j.title}
                        >
                          <span>{t.apply}</span><ExternalLink size={14} strokeWidth={2.2} />
                        </a>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            {list.length === 0 && (
              <div className="empty">
                <h3>{isSavedView ? t.savedEmpty : t.noResults}</h3>
                <p>{isSavedView ? t.savedEmptyHint : t.noResultsHint}</p>
                <button className="btn-primary" onClick={isSavedView ? () => setView('jobs') : clearFilters}>
                  {isSavedView ? t.browse : t.clear}
                </button>
              </div>
            )}
            {!mob && list.length > 1 && <p className="key-hint">{t.keyHint}</p>}
          </section>
        )}

        {showDetail && (
          <section className="pane detail" aria-label={sel?.title}>
            {sel ? (
              <Detail
                job={sel} t={t} mob={mob} saved={saved.includes(sel.id)}
                onSave={() => toggleSave(sel!.id)}
                onClose={() => setDetailOpen(false)} onHide={() => setPanel(true)}
                onCopy={() => { try { void navigator.clipboard.writeText(sel!.url); } catch { /* ignore */ } showToast(t.copied); }}
              />
            ) : (
              !mob && <div className="select-job">{t.selectJob}</div>
            )}
          </section>
        )}
      </main>

      {mob && !showDetail && <nav className="tabbar">{TabButtons()}</nav>}

      {sheetOpen && (
        <div className="backdrop" onClick={() => setSheetOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label={t.filters} onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <h2>{t.filters}</h2>
              <button className="icon-btn sheet-close" aria-label={t.close} onClick={() => setSheetOpen(false)}><X size={20} {...ico} /></button>
            </div>
            <div className="sheet-body">
              <SheetGroup label={t.role}>
                {roleItems.map(([k, l]) => <button key={k} className="chip" aria-pressed={roles.includes(k)} onClick={() => toggleIn('roles', k)}>{l}</button>)}
              </SheetGroup>
              <SheetGroup label={t.seniority}>
                {senItems.map(([k, l]) => <button key={k} className="chip" aria-pressed={sens.includes(k)} onClick={() => toggleIn('sens', k)}>{l}</button>)}
              </SheetGroup>
              <label className="sheet-group">
                <span className="label-caps">{t.country}</span>
                <select className="select" value={country} onChange={(e) => patch({ country: e.target.value })}>
                  {countryOpts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="sheet-group">
                <span className="label-caps">{t.posted}</span>
                <select className="select" value={posted} onChange={(e) => patch({ posted: e.target.value as Posted })}>
                  {postedOpts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <button className="sheet-alert" onClick={openAlert}><Bell size={16} {...ico} /><span>{t.alertsSearch}</span></button>
            </div>
            <div className="sheet-foot">
              <button className="btn-secondary" onClick={clearFilters}>{t.clear}</button>
              <button className="btn-primary" onClick={() => setSheetOpen(false)}>{t.showN(filtered.length)}</button>
            </div>
          </div>
        </div>
      )}

      {alertOpen && (
        <AlertDialog
          t={t} summary={summaryBits.length ? summaryBits.join(' · ') : t.allJobs}
          sent={alertSent} email={email} invalid={emailInvalid}
          onEmail={setEmail} onClose={() => setAlertOpen(false)}
          onSubmit={() => { if (!emailInvalid) setAlertSent(true); /* TODO: POST to alerts API (double opt-in) */ }}
        />
      )}

      {toast && <div role="status" className="toast" style={{ bottom: toastBottom }}>{toast}</div>}
    </div>
  );
}

function SheetGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sheet-group">
      <span className="label-caps">{label}</span>
      <div className="sheet-chips">{children}</div>
    </div>
  );
}

function Detail({ job, t, mob, saved, onSave, onClose, onHide, onCopy }: {
  job: Job; t: Strings; mob: boolean; saved: boolean;
  onSave: () => void; onClose: () => void; onHide: () => void; onCopy: () => void;
}) {
  const applyLabel = mob ? t.apply : t.applyOn(domain(job.url));
  const meta = [
    { label: t.seniority, value: t.sen[job.sen] },
    { label: t.contract, value: t[job.ct] },
    { label: t.eligible, value: eligText(job, t) },
    { label: t.salary, value: job.pay || t.salaryNA },
  ];
  const ApplyLink = (cls: string) => (
    <a className={cls} href={job.url} target="_blank" rel="noopener noreferrer">
      <span>{applyLabel}</span><ExternalLink size={16} strokeWidth={2.2} />
    </a>
  );
  return (
    <>
      {mob ? (
        <div className="back-bar">
          <button className="back-btn" onClick={onClose}><ArrowLeft size={18} {...ico} /><span>{t.back}</span></button>
        </div>
      ) : (
        <div className="detail-close-row">
          <button className="icon-btn detail-close" aria-label={t.hideDetails} title={t.hideDetails + ' (Esc)'} onClick={onHide}><X size={18} {...ico} /></button>
        </div>
      )}
      <div className="detail-inner">
        <div className="detail-head">
          <div className="company-row">
            <div className="logo lg" aria-hidden="true">{job.ini}</div>
            <div>
              <span className="company-name">{job.company}</span>
              <span className="small-muted">{rel(job.h, t)}</span>
            </div>
          </div>
          <h1>{job.title}</h1>
          {!mob && (
            <div className="actions">
              {ApplyLink("apply")}
              <button className="btn-save" aria-pressed={saved} onClick={onSave}>
                <Bookmark size={16} strokeWidth={2} strokeLinejoin="round" /><span>{saved ? t.savedBtn : t.save}</span>
              </button>
              <button className="icon-btn copy-btn" aria-label={t.copy} title={t.copy} onClick={onCopy}><Copy size={16} {...ico} /></button>
              <span className="opens">{t.opensOn}</span>
            </div>
          )}
        </div>
        <dl className="facts">
          {meta.map((m) => (
            <div key={m.label}><dt>{m.label}</dt><dd>{m.value}</dd></div>
          ))}
        </dl>
        <div className="section"><h2>{t.about}</h2><p>{job.about}</p></div>
        <div className="section"><h2>{t.reqs}</h2><ul>{job.reqs.map((r) => <li key={r}>{r}</li>)}</ul></div>
        <div className="section"><h2>{t.stack}</h2><div className="tags">{job.stack.map((s) => <span key={s} className="pill">{s}</span>)}</div></div>
        <p className="footnote">{t.inEnglish}</p>
      </div>
      {mob && (
        <div className="sticky-bar">
          <button className="icon-btn save-sq" aria-pressed={saved} aria-label={saved ? t.savedBtn : t.save} onClick={onSave}>
            <Bookmark size={18} strokeWidth={2} strokeLinejoin="round" />
          </button>
          {ApplyLink("apply apply-m")}
        </div>
      )}
    </>
  );
}

function AlertDialog({ t, summary, sent, email, invalid, onEmail, onClose, onSubmit }: {
  t: Strings; summary: string; sent: boolean; email: string; invalid: boolean;
  onEmail: (v: string) => void; onClose: () => void; onSubmit: () => void;
}) {
  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t.alertTitle} onClick={(e) => e.stopPropagation()}>
        <h2>{t.alertTitle}</h2>
        {!sent ? (
          <>
            <p>{t.alertBody}</p>
            <p className="summary">{summary}</p>
            <label className="field">
              <span>{t.email}</span>
              <input type="email" value={email} onChange={(e) => onEmail(e.target.value)} placeholder="tu@correo.com" autoFocus />
            </label>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={onClose}>{t.cancel}</button>
              <button className="btn-primary" disabled={invalid} onClick={onSubmit}>{t.create}</button>
            </div>
          </>
        ) : (
          <>
            <p>{t.alertDone}</p>
            <div className="modal-actions"><button className="btn-done" onClick={onClose}>{t.done}</button></div>
          </>
        )}
      </div>
    </div>
  );
}
