import { useCallback, useEffect, useRef, useState } from 'react';

// Runs an async loader and exposes {data, error, loading, reload}. Ignores stale results.
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const run = useRef(0);
  const load = useCallback(async () => {
    const id = ++run.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fn();
      if (id === run.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (id === run.current) setState({ data: null, error, loading: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

// Throws on a Supabase error so useAsync / try-catch handle it uniformly.
export function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}
