import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from './lib/supabase.js';

const Ctx = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ session: null, profile: null, isAdmin: false, loading: true, recovery: false });

  const load = useCallback(async (session, recoveryOverride) => {
    if (!session) {
      setState({ session: null, profile: null, isAdmin: false, loading: false, recovery: Boolean(recoveryOverride) });
      return;
    }
    const { data: profile } = await supabase.from('profiles').select('*, organizations(*)').eq('id', session.user.id).maybeSingle();
    const { data: stats } = await supabase.rpc('dashboard_stats');
    setState((previous) => ({
      session,
      profile,
      isAdmin: Boolean(stats && stats.admin),
      loading: false,
      recovery: recoveryOverride === undefined ? previous.recovery : Boolean(recoveryOverride),
    }));
  }, []);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => { if (active) load(data.session, false); });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY') load(session, true);
      else if (event === 'SIGNED_OUT') load(null, false);
      else load(session);
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, [load]);

  const value = useMemo(() => ({
    ...state,
    org: state.profile ? state.profile.organizations : null,
    role: state.profile ? state.profile.role : null,
    refresh: async () => { const { data } = await supabase.auth.getSession(); await load(data.session); },
    clearRecovery: () => setState((current) => ({ ...current, recovery: false })),
    signOut: () => supabase.auth.signOut(),
  }), [state, load]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
