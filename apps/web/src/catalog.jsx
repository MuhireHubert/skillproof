import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from './lib/supabase.js';

const Ctx = createContext(null);

// The competency framework (sectors + competencies) is data; every screen reads it from here.
export function CatalogProvider({ children }) {
  const [state, setState] = useState({ sectors: [], competencies: [], loading: true });
  useEffect(() => {
    let alive = true;
    (async () => {
      const [s, c] = await Promise.all([
        supabase.from('sectors').select('*').eq('active', true).order('name'),
        supabase.from('competencies').select('id, sector_id, name, category').order('name'),
      ]);
      if (alive) setState({ sectors: s.data || [], competencies: c.data || [], loading: false });
    })();
    return () => { alive = false; };
  }, []);

  const value = useMemo(() => {
    const cName = new Map(state.competencies.map((c) => [c.id, c.name]));
    const sName = new Map(state.sectors.map((s) => [s.id, s.name]));
    return {
      ...state,
      professional: state.competencies.filter((c) => c.category === 'professional'),
      sector: (id) => state.sectors.find((s) => s.id === id),
      sectorName: (id) => sName.get(id) || id || '',
      compName: (id) => cName.get(id) || id,
      forSector: (id) => state.competencies.filter((c) => c.sector_id === id),
    };
  }, [state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useCatalog = () => useContext(Ctx);
