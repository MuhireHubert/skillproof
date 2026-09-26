import { Children, cloneElement, createContext, forwardRef, isValidElement, useCallback, useContext, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { cx, LEVELS, levelName, STATUS } from './lib/format.js';
import { useCatalog } from './catalog.jsx';

/* ------------------------------------------------------------------ brand */
export function Seal({ size = 28, className }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" className={cx('shrink-0 text-ok', className)}>
      <circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="24" cy="24" r="16.5" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2.6" />
      <path d="M15.5 24.5l6 6 11-13" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* --------------------------------------------------------------- controls */
export function Button({ variant, small, className, ...props }) {
  return (
    <button
      type="button"
      {...props}
      className={cx('btn', variant === 'ghost' && 'btn-ghost', variant === 'go' && 'btn-go', variant === 'danger' && 'btn-danger', small && 'btn-sm', className)}
    />
  );
}
export const Input = forwardRef(function Input(props, ref) { return <input ref={ref} {...props} className={cx('input', props.className)} />; });
export const Textarea = forwardRef(function Textarea(props, ref) { return <textarea ref={ref} rows={props.rows || 4} {...props} className={cx('input', props.className)} />; });

export function Select({ options, placeholder, ...props }) {
  return (
    <select {...props} className={cx('input', props.className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.v} value={o.v}>{o.n}</option>)}
    </select>
  );
}

// Label + control. The label is wired to the control's id automatically.
export function Field({ label, hint, children, className }) {
  const id = useId();
  const child = Children.count(children) === 1 && isValidElement(children) ? cloneElement(children, { id: children.props.id || id }) : children;
  const forId = isValidElement(child) ? child.props.id : undefined;
  return (
    <div className={cx('mb-4', className)}>
      <label className="label" htmlFor={forId}>{label}</label>
      {child}
      {hint && <p className="mt-1 text-xs text-ink-soft">{hint}</p>}
    </div>
  );
}

export function CheckChip({ checked, onChange, children }) {
  return (
    <label className={cx('inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-sm', checked ? 'border-ok bg-ok-bg' : 'border-line bg-white')}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

/* ------------------------------------------------------------------ badges */
export const Chip = ({ children, tone }) => <span className={cx('chip', tone === 'strong' && 'chip-strong', tone === 'mid' && 'chip-mid')}>{children}</span>;

export function StatusPill({ status }) {
  const s = STATUS[status] || STATUS.draft;
  return <span className={cx('pill', s.cls)}>{status === 'verified' && <Seal size={16} />}{s.label}</span>;
}
export const Pill = ({ tone = 'wait', children }) => (
  <span className={cx('pill', tone === 'ok' && 'border-[#B7DFCE] bg-ok-bg text-ok-ink', tone === 'wait' && 'border-[#EBCF97] bg-wait-bg text-wait', tone === 'rev' && 'border-[#BFD0EC] bg-rev-bg text-rev', tone === 'no' && 'border-[#EBC2C2] bg-no-bg text-no', tone === 'plain' && 'border-line bg-white text-ink-soft')}>{children}</span>
);

export function Meter({ level }) {
  return (
    <span className="inline-flex gap-[3px]" role="img" aria-label={levelName(level)}>
      {[1, 2, 3, 4].map((i) => <i key={i} className={cx('h-2 w-[18px] rounded-sm', i <= level ? 'bg-ok' : 'bg-[#DCE3EE]')} />)}
    </span>
  );
}
export function LevelRow({ name, level, extra }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 border-t border-[#EDF1F6] py-1.5 first:border-t-0 sm:grid-cols-[minmax(140px,1.4fr)_auto_minmax(110px,1fr)]">
      <span className="font-medium">{name}</span>
      <Meter level={level} />
      <small className="col-span-2 text-ink-soft sm:col-span-1">{levelName(level)}{extra ? ', ' + extra : ''}</small>
    </div>
  );
}
export function VerifiedStamp({ date }) {
  return (
    <div className="flex min-w-[64px] flex-col items-center text-center text-xs font-semibold text-ok">
      <Seal size={44} />Verified{date && <span className="font-normal text-ink-soft">{new Date(date).toLocaleDateString()}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ layout */
export function Card({ status, className, children }) {
  const rail = status ? (STATUS[status] || {}).rail : 'border-l-line';
  return <article className={cx('card mb-3', rail || 'border-l-line', className)}>{children}</article>;
}
export const Empty = ({ children }) => <div className="rounded border border-dashed border-[#B9C3D3] bg-white p-6 text-ink-soft">{children}</div>;
export function Notice({ tone = 'wait', children }) {
  const t = { wait: 'border-[#EBCF97] bg-wait-bg', bad: 'border-[#EBC2C2] bg-no-bg', info: 'border-[#BFD0EC] bg-rev-bg', ok: 'border-[#B7DFCE] bg-ok-bg' }[tone];
  return <div className={cx('mb-4 rounded border px-3.5 py-2.5 text-sm', t)}>{children}</div>;
}
export const Loading = () => <p className="text-ink-soft">Loading…</p>;
export const ErrorNote = ({ error }) => <Notice tone="bad">{error && error.message ? error.message : 'Something went wrong.'}</Notice>;
export function PageHeader({ title, sub, action }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div><h2>{title}</h2>{sub && <p className="mt-1 max-w-2xl text-ink-soft">{sub}</p>}</div>
      {action}
    </div>
  );
}
export function Panel({ title, children, className }) {
  return <section className={cx('mb-6 rounded border border-line bg-white p-5', className)}>{title && <h3 className="mb-3">{title}</h3>}{children}</section>;
}
// Renders loading / error / content for a useAsync result.
export function Async({ state, children }) {
  if (state.loading && !state.data) return <Loading />;
  if (state.error) return <ErrorNote error={state.error} />;
  return children(state.data);
}
export function Stat({ label, value, to, tone }) {
  const body = (
    <div className={cx('rounded border border-line bg-white p-4', to && 'hover:border-ink')}>
      <div className={cx('font-display text-3xl font-extrabold', tone === 'alert' && Number(value) > 0 && 'text-wait')}>{value ?? 0}</div>
      <div className="text-sm text-ink-soft">{label}</div>
    </div>
  );
  return to ? <Link to={to} className="text-ink no-underline">{body}</Link> : body;
}

/* --------------------------------------------------- framework-aware inputs */
export function SectorSelect({ value, onChange, placeholder, ...rest }) {
  const { sectors } = useCatalog();
  return <Select value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} options={sectors.map((s) => ({ v: s.id, n: s.name }))} {...rest} />;
}
export function SectorChecks({ value, onChange }) {
  const { sectors } = useCatalog();
  return (
    <div className="flex flex-wrap gap-2">
      {sectors.map((s) => (
        <CheckChip key={s.id} checked={value.includes(s.id)} onChange={(on) => onChange(on ? [...value, s.id] : value.filter((x) => x !== s.id))}>{s.name}</CheckChip>
      ))}
    </div>
  );
}
// Checkbox chips for competencies. Pass `only` (ids) to restrict the list.
export function CompetencyChecks({ sectorId, value, onChange, only }) {
  const { forSector, compName } = useCatalog();
  const list = only ? only.map((id) => ({ id, name: compName(id) })) : forSector(sectorId);
  if (!list.length) return <p className="text-sm text-ink-soft">No competencies defined for this sector yet.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {list.map((c) => (
        <CheckChip key={c.id} checked={value.includes(c.id)} onChange={(on) => onChange(on ? [...value, c.id] : value.filter((x) => x !== c.id))}>{c.name}</CheckChip>
      ))}
    </div>
  );
}
export const LevelSelect = ({ value, onChange, placeholder, ...rest }) => (
  <Select value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} placeholder={placeholder} options={LEVELS.map((l) => ({ v: l.v, n: l.v + ' ' + l.n }))} {...rest} />
);
export function LevelLegend() {
  return <Notice tone="info"><strong>Levels: </strong>{LEVELS.map((l) => l.v + ' ' + l.n + ' (' + l.d.toLowerCase() + ')').join('; ')}</Notice>;
}

/* ------------------------------------------------------------------ toasts */
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [t, setT] = useState(null);
  const toast = useCallback((message, tone = 'ok') => {
    setT({ message, tone, id: Math.random() });
    setTimeout(() => setT((cur) => (cur && cur.message === message ? null : cur)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
        {t && <div className={cx('max-w-[90vw] rounded px-4 py-2.5 text-sm text-white shadow-lg', t.tone === 'bad' ? 'bg-no' : 'bg-ink')}>{t.message}</div>}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// Wraps an async action with a busy flag and error toast.
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, okMessage) => {
    setBusy(true);
    try {
      const r = await fn();
      if (okMessage) toast(okMessage);
      return r === undefined ? true : r;
    } catch (e) {
      toast(e && e.message ? e.message : 'Something went wrong', 'bad');
      return false;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return [run, busy];
}
