import { supabase } from './supabase.js';

const base = (import.meta.env.VITE_API_URL || 'http://localhost:8787').replace(/\/$/, '');

async function request(method, path, body, auth = true) {
  const headers = { 'content-type': 'application/json' };
  if (auth) {
    const { data } = await supabase.auth.getSession();
    if (data.session) headers.authorization = 'Bearer ' + data.session.access_token;
  }
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Request failed (' + res.status + ')');
  return json;
}

export const api = {
  get: (path, auth = true) => request('GET', path, undefined, auth),
  post: (path, body, auth = true) => request('POST', path, body, auth),
  // Authenticated CSV download (opens a save dialog)
  async download(path, filename) {
    const { data } = await supabase.auth.getSession();
    const res = await fetch(base + path, { headers: { authorization: 'Bearer ' + (data.session?.access_token || '') } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Download failed');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  },
};
