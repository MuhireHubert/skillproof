import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../lib/supabase.js', async () => await import('./mockSupabase.js'));
import { state, supabase } from './mockSupabase.js';
import App from '../App.jsx';
import { AuthProvider } from '../auth.jsx';
import { CatalogProvider } from '../catalog.jsx';
import { ToastProvider } from '../ui.jsx';

function mount(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider><AuthProvider><CatalogProvider><App /></CatalogProvider></AuthProvider></ToastProvider>
    </MemoryRouter>,
  );
}
beforeEach(() => { state.admin = false; state.signedOut = false; vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('key actions send the right requests', () => {
  it('employer review refuses to verify without ratings, then sends every rating', async () => {
    state.role = 'employer';
    const rpc = vi.spyOn(supabase, 'rpc');
    mount('/review');
    const verify = await screen.findByRole('button', { name: 'Verify' });
    fireEvent.click(verify);
    await screen.findByText('Rate every competency before verifying.');
    expect(rpc.mock.calls.filter((c) => c[0] === 'review_evidence')).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('Level for Engine diagnostics'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Level for Workshop safety'), { target: { value: '4' } });
    fireEvent.change(screen.getAllByPlaceholderText(/What went well/)[0], { target: { value: 'Solid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(rpc.mock.calls.some((c) => c[0] === 'review_evidence')).toBe(true));
    const [, args] = rpc.mock.calls.find((c) => c[0] === 'review_evidence');
    expect(args).toMatchObject({ p_evidence: 'e1', p_status: 'verified', p_note: 'Solid', p_ratings: { 'mechanics-engine-diagnostics': 3, 'mechanics-workshop-safety': 4 } });
  });

  it('employer must explain a request for changes', async () => {
    state.role = 'employer';
    const rpc = vi.spyOn(supabase, 'rpc');
    mount('/review');
    fireEvent.click(await screen.findByRole('button', { name: 'Request changes' }));
    await screen.findByText(/Add a note so the student knows/);
    expect(rpc.mock.calls.filter((c) => c[0] === 'review_evidence')).toHaveLength(0);
  });

  it('institution turns a skill gap into a curriculum action', async () => {
    state.role = 'institution';
    const from = vi.spyOn(supabase, 'from');
    mount('/gap');
    const buttons = await screen.findAllByRole('button', { name: 'Create action' });
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(from.mock.calls.some((c) => c[0] === 'curriculum_actions')).toBe(true));
    await screen.findByText('Added to your curriculum actions.');
  });

  it('employer talent search passes sector, competencies and level to discover_talent', async () => {
    state.role = 'employer';
    const rpc = vi.spyOn(supabase, 'rpc');
    mount('/talent');
    fireEvent.click(await screen.findByRole('button', { name: 'Search' }));
    await screen.findByText('Ada Uwase', {}, { timeout: 3000 });
    const [, args] = rpc.mock.calls.find((c) => c[0] === 'discover_talent');
    expect(args).toEqual({ p_sector: 'mechanics', p_competencies: [], p_min_level: 3 });
    expect(screen.getByText(/2 matching competencies/)).toBeTruthy();
  });

  it('a supervisor must rate every competency before verifying, and the sign-off is posted once ratings exist', async () => {
    state.signedOut = true;
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push([url, init]);
      if (init && init.method === 'POST') return { ok: true, json: async () => ({ ok: true }) };
      return { ok: true, json: async () => ({ verifier_name: 'Sam', verifier_role: 'Lead', title: 'Clutch job', description: 'Did it', link: '', hours: '4', student_name: 'Stu', evidence_type: '', sector_name: 'Mechanics', verifier_label: 'Lead', competencies: [{ id: 'c1', name: 'Engine diagnostics' }], media: [] }) };
    });
    mount('/v/tok123');
    fireEvent.click(await screen.findByRole('button', { name: 'Verify' }));
    await screen.findByText('Rate every competency before verifying.');
    expect(calls.filter(([, i]) => i && i.method === 'POST')).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Level for Engine diagnostics'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await screen.findByText(/Thank you/);
    const post = calls.find(([, i]) => i && i.method === 'POST');
    expect(post[0]).toMatch(/\/api\/verify\/tok123$/);
    expect(JSON.parse(post[1].body)).toMatchObject({ decision: 'verified', ratings: { c1: 3 } });
    expect(post[1].headers.authorization).toBeUndefined();
  });

  it('student sees a public toggle only on verified work and a verification request form on self-logged work', async () => {
    state.role = 'student';
    mount('/evidence/e1');
    await screen.findByText('Ask a supervisor to verify this');
    expect(screen.getByRole('button', { name: 'Create verification request' })).toBeTruthy();
    expect(screen.queryByText('Show on my public profile')).toBeNull();
  });
});
