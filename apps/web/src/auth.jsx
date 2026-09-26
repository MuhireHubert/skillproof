import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from './lib/supabase.js';

const Ctx = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ session: null, profile: null, isAdmin: false, loading: true });

  const load = useCallback(async (session) => {
    if (!session) { setState({ session: null, profile: null, isAdmin: false, loading: false }); return; }
    const { data: profile } = await supabase.from('profiles').select('*, organizations(*)').eq('id', session.user.id).maybeSingle();
    const { data: stats } = await supabase.rpc('dashboard_stats');
    setState({ session, profile, isAdmin: Boolean(stats && stats.admin), loading: false });
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => load(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => { load(session); });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const value = useMemo(() => ({
    ...state,
    org: state.profile ? state.profile.organizations : null,
    role: state.profile ? state.profile.role : null,
    refresh: async () => { const { data } = await supabase.auth.getSession(); await load(data.session); },
    signOut: () => supabase.auth.signOut(),
  }), [state, load]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
