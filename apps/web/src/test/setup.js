import { vi } from 'vitest';

window.scrollTo = vi.fn();
window.confirm = vi.fn(() => true);
Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn() }, configurable: true });
