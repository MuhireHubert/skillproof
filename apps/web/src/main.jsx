import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './auth.jsx';
import { CatalogProvider } from './catalog.jsx';
import { ToastProvider } from './ui.jsx';
import { configured } from './lib/supabase.js';
import './index.css';

function Setup() {
  return (
    <div className="mx-auto max-w-xl p-10">
      <h1>Connect your Supabase project</h1>
      <p className="mt-3 text-ink-soft">Copy <code>.env.example</code> to <code>.env</code>, set <code>VITE_SUPABASE_URL</code>, <code>VITE_SUPABASE_ANON_KEY</code> and <code>VITE_API_URL</code>, then restart the dev server. The README lists the setup steps.</p>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {configured ? (
      <HashRouter>
        <ToastProvider><AuthProvider><CatalogProvider><App /></CatalogProvider></AuthProvider></ToastProvider>
      </HashRouter>
    ) : <Setup />}
  </React.StrictMode>,
);
