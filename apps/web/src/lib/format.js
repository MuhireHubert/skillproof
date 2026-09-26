export const LEVELS = [
  { v: 1, n: 'Learning', d: 'Can do it with guidance' },
  { v: 2, n: 'Supervised', d: 'Can do it with light review' },
  { v: 3, n: 'Independent', d: 'Meets the workplace standard alone' },
  { v: 4, n: 'Advanced', d: 'Handles complex cases and guides others' },
];
export const IMPORTANCE = [
  { v: 1, n: 'Nice to have' },
  { v: 2, n: 'Expected' },
  { v: 3, n: 'Essential' },
];
export const levelName = (v) => (LEVELS[v - 1] ? LEVELS[v - 1].n : 'Not rated');

export const STATUS = {
  draft: { label: 'Draft', cls: 'border-line text-ink-soft bg-white', rail: 'border-l-line' },
  submitted: { label: 'Awaiting review', cls: 'border-[#EBCF97] text-wait bg-wait-bg', rail: 'border-l-[#D9A441]' },
  verified: { label: 'Verified', cls: 'border-[#B7DFCE] text-ok-ink bg-ok-bg', rail: 'border-l-ok' },
  revision: { label: 'Changes requested', cls: 'border-[#BFD0EC] text-rev bg-rev-bg', rail: 'border-l-rev' },
  declined: { label: 'Declined', cls: 'border-[#EBC2C2] text-no bg-no-bg', rail: 'border-l-no' },
};

export const ASSURANCE = {
  org_verified: 'Verified by the employer',
  external_attested: 'Attested by a supervisor (link)',
  ussd_attested: 'Attested by a supervisor (phone)',
};

export const ROLE_LABEL = { student: 'Student', employer: 'Employer', institution: 'Institution', regulator: 'Regulator' };
export const PIPELINE_STAGES = ['shortlisted', 'invited', 'assessing', 'interviewing', 'offered', 'rejected'];
export const RESPONSE_STATUS = [
  { v: 'adopted', n: 'Adopted' },
  { v: 'adapted', n: 'Adapted' },
  { v: 'planned', n: 'Planned' },
  { v: 'declined', n: 'Not adopting' },
];
export const PREPAREDNESS = [
  { v: 'ready', n: 'Ready from day one' },
  { v: 'mostly', n: 'Mostly ready' },
  { v: 'partly', n: 'Partly ready' },
  { v: 'not_ready', n: 'Not ready' },
];

export const fmtDate = (v) => (v ? new Date(v).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
export const isoInDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
export const cx = (...a) => a.filter(Boolean).join(' ');
export const isHttpUrl = (u) => /^https?:\/\/\S+$/i.test(u);
export const safeName = (n) => n.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80);
export const mediaKind = (type) => (type.startsWith('image/') ? 'image' : type.startsWith('video/') ? 'video' : 'document');
