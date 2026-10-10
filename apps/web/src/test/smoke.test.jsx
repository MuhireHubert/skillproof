import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../lib/supabase.js', async () => await import('./mockSupabase.js'));
import { state } from './mockSupabase.js';
import App from '../App.jsx';
import { AuthProvider } from '../auth.jsx';
import { CatalogProvider } from '../catalog.jsx';
import { ToastProvider } from '../ui.jsx';

const ROUTES = {
  student: ['/', '/projects', '/internships', '/evidence', '/evidence/e1', '/assessments', '/journey', '/profile'],
  employer: ['/', '/standards', '/projects', '/internships', '/review', '/talent', '/assessments', '/feedback'],
  institution: ['/', '/standards', '/demand', '/gap', '/programmes', '/enrollments', '/assessments', '/outcomes', '/actions'],
  regulator: ['/', '/requirements', '/compliance'],
};

function mount(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider><AuthProvider><CatalogProvider><App /></CatalogProvider></AuthProvider></ToastProvider>
    </MemoryRouter>,
  );
}

let errors;
beforeEach(() => { errors = vi.spyOn(console, 'error').mockImplementation(() => {}); state.admin = false; state.noProfile = false; state.signedOut = false; });
afterEach(() => { cleanup(); errors.mockRestore(); });

async function settle() {
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull(), { timeout: 4000 });
  await new Promise((r) => setTimeout(r, 30));
}

describe('every screen renders with data for its role', () => {
  for (const [role, routes] of Object.entries(ROUTES)) {
    for (const path of routes) {
      it(role + ' ' + path, async () => {
        state.role = role;
        mount(path);
        await screen.findByText(/Sign out/, {}, { timeout: 4000 });
        await settle();
        expect(screen.queryByText(/This section is not available/)).toBeNull();
        expect(screen.queryByText(/Something went wrong/)).toBeNull();
        expect(errors.mock.calls.map((c) => String(c[0]).slice(0, 200))).toEqual([]);
      });
    }
  }

  it('shows a separate admin workspace to platform administrators', async () => {
    state.role = 'institution'; state.admin = true;
    mount('/admin');
    await screen.findByText('Administrator workspace');
    await settle();
    expect(screen.getByRole('button', { name: 'Sectors' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Users & admins' })).toBeTruthy();
    expect(errors.mock.calls).toEqual([]);
  });

  it('redirects non-admins away from the admin workspace', async () => {
    state.role = 'employer';
    mount('/admin');
    await screen.findByText(/The operating loop/);
    expect(screen.queryByText('Administrator workspace')).toBeNull();
  });

  it('allows a platform administrator without a student or organisation profile', async () => {
    state.role = 'student'; state.admin = true; state.noProfile = true;
    mount('/admin');
    await screen.findByText('Administrator workspace');
    expect(screen.getByRole('button', { name: 'Sectors' })).toBeTruthy();
    expect(errors.mock.calls).toEqual([]);
  });
});

describe('public and signed-out screens', () => {
  it('renders the sign-in page when signed out', async () => {
    state.signedOut = true;
    mount('/');
    await screen.findByText(/Good work should speak for itself/);
    expect(screen.getAllByText('Sign in').length).toBeGreaterThan(0);
    expect(errors.mock.calls).toEqual([]);
  });

  it('renders a public portfolio without signing in', async () => {
    state.signedOut = true;
    mount('/p/test');
    await screen.findByText('Ada Uwase');
    await settle();
    expect(screen.getByText('Verified work')).toBeTruthy();
    expect(errors.mock.calls).toEqual([]);
  });

  it('renders the outside-verifier page from the API response', async () => {
    state.signedOut = true;
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ verifier_name: 'Sam', verifier_role: 'Lead', title: 'Clutch job', description: 'Did it', link: '', hours: '4', student_name: 'Stu', evidence_type: '', sector_name: 'Mechanics', verifier_label: 'Lead', competencies: [{ id: 'c1', name: 'Engine diagnostics' }], media: [] }) }));
    mount('/v/sometoken');
    await screen.findByText("Verify Stu's work");
    expect(screen.getByText('Engine diagnostics')).toBeTruthy();
    expect(screen.getByText('Verify')).toBeTruthy();
    expect(errors.mock.calls).toEqual([]);
  });

  it('shows a clear message for an expired verification link', async () => {
    state.signedOut = true;
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 410, json: async () => ({ error: 'This verification link is invalid or has expired' }) }));
    mount('/v/old');
    await screen.findByText(/invalid or has expired/);
  });
});
