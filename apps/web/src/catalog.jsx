import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from './lib/supabase.js';

const Ctx = createContext(null);

// The catalogue is centrally managed. Only active entries are offered in user-facing selectors.
export function CatalogProvider({ children }) {
  const [state, setState] = useState({ sectors: [], competencies: [], loading: true, error: null });
  const reload = useCallback(async () => {
    setState((old) => ({ ...old, loading: true, error: null }));
    const [s, c] = await Promise.all([
      supabase.from('sectors').select('*').eq('active', true).order('name'),
      supabase.from('competencies').select('id, sector_id, name, category, description').eq('active', true).order('name'),
    ]);
    if (s.error || c.error) {
      setState((old) => ({ ...old, loading: false, error: s.error || c.error }));
      return;
    }
    setState({ sectors: s.data || [], competencies: c.data || [], loading: false, error: null });
  }, []);

  useEffect(() => {
    reload();
    const onFocus = () => reload();
    window.addEventListener('focus', onFocus);
    const channel = supabase.channel('skillproof-managed-catalog')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sectors' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'competencies' }, reload)
      .subscribe();
    return () => {
      window.removeEventListener('focus', onFocus);
      supabase.removeChannel(channel);
    };
  }, [reload]);

  const value = useMemo(() => {
    const cName = new Map(state.competencies.map((c) => [c.id, c.name]));
    const sName = new Map(state.sectors.map((s) => [s.id, s.name]));
    return {
      ...state,
      reload,
      professional: state.competencies.filter((c) => c.category === 'professional'),
      sector: (id) => state.sectors.find((s) => s.id === id),
      sectorName: (id) => sName.get(id) || id || '',
      compName: (id) => cName.get(id) || id,
      forSector: (id) => state.competencies.filter((c) => c.sector_id === id),
    };
  }, [state, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useCatalog = () => useContext(Ctx);
