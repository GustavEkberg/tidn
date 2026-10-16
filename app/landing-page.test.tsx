import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LandingPage } from './landing-page';

vi.mock('@/components/auth-background', () => ({ AuthBackground: () => null }));

describe('signed-out landing page', () => {
  it('offers a login link with button styling and native link semantics', () => {
    const container = document.createElement('div');
    container.innerHTML = renderToStaticMarkup(<LandingPage />);
    const link = container.querySelector('a[href="/login"]');
    expect(link?.textContent).toBe('Log in');
    expect(link?.getAttribute('role')).toBeNull();
    expect(link?.getAttribute('class')).toContain('bg-primary');
  });
});
