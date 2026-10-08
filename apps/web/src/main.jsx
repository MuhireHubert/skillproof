import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './auth.jsx';
import { CatalogProvider } from './catalog.jsx';
import { ToastProvider } from './ui.jsx';
import { configured } from './lib/supabase.js';
import './index.css';

function showRuntimeError(title, error) {
  const root = document.getElementById('root');
  if (!root) return;
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  root.innerHTML = `
    <div style="max-width:760px;margin:48px auto;padding:24px;font-family:system-ui,sans-serif;color:#17202a">
      <div style="border:1px solid #e5bcbc;background:#fff7f7;border-radius:12px;padding:24px">
        <h1 style="margin:0 0 10px;font-size:24px">${title}</h1>
        <p style="margin:0 0 16px;line-height:1.5">The SkillProof frontend loaded, but an error prevented the application from starting.</p>
        <pre style="white-space:pre-wrap;overflow:auto;background:#fff;border:1px solid #eadede;border-radius:8px;padding:14px;font-size:13px">${message}</pre>
        <p style="margin:16px 0 0;font-size:13px;color:#5d6872">Open the browser console for the full stack trace. This screen is intentionally visible so deployment failures do not look like a blank page.</p>
      </div>
    </div>`;
}

window.addEventListener('error', (event) => {
  if (event.error) showRuntimeError('SkillProof frontend error', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  showRuntimeError('SkillProof startup error', event.reason);
});

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error('SkillProof React render error:', error);
  }

  render() {
    if (this.state.error) {
      return <RuntimeError error={this.state.error} />;
    }
    return this.props.children;
  }
}

function RuntimeError({ error }) {
  return (
    <div className="mx-auto max-w-3xl p-10">
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-950">
        <h1 className="text-2xl font-bold">SkillProof frontend error</h1>
        <p className="mt-2">The application started but a React component failed while rendering.</p>
        <pre className="mt-4 overflow-auto rounded-lg bg-white p-4 text-sm">{error?.message || String(error)}</pre>
        <p className="mt-4 text-sm">Open the browser console for the full stack trace. This error screen is intentional so deployment problems are visible instead of appearing as a blank page.</p>
      </div>
    </div>
  );
}

function Setup() {
  const missing = [];
  if (!import.meta.env.VITE_SUPABASE_URL) missing.push('VITE_SUPABASE_URL');
  if (!import.meta.env.VITE_SUPABASE_ANON_KEY) missing.push('VITE_SUPABASE_ANON_KEY');

  return (
    <div className="mx-auto max-w-xl p-10">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
        <h1 className="text-2xl font-bold">SkillProof is not configured</h1>
        <p className="mt-3 text-ink-soft">
          The frontend is running, but the production build did not receive the required Supabase settings.
        </p>
        <p className="mt-4 font-semibold">Missing: {missing.join(', ') || 'Supabase configuration'}</p>
        <p className="mt-3 text-sm text-ink-soft">
          Add the values as GitHub Actions secrets and redeploy. VITE_API_URL is only needed for API-backed features; it is not required to render this screen.
        </p>
      </div>
    </div>
  );
}

try {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <AppErrorBoundary>
        {configured ? (
          <HashRouter>
            <ToastProvider><AuthProvider><CatalogProvider><App /></CatalogProvider></AuthProvider></ToastProvider>
          </HashRouter>
        ) : <Setup />}
      </AppErrorBoundary>
    </React.StrictMode>,
  );
} catch (error) {
  showRuntimeError('SkillProof failed to start', error);
}
