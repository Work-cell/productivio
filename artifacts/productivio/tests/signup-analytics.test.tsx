// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { markSignUpStarted, trackSignUpCompletedOnce } from '../src/lib/analytics';

const authState = vi.hoisted(() => ({
  isLoaded: true,
  isSignedIn: true,
  user: {
    id: 'student-test',
    fullName: 'Riley Student',
    primaryEmailAddress: { emailAddress: 'student@example.edu' },
  } as { id: string; fullName: string; primaryEmailAddress: { emailAddress: string } } | null,
}));

vi.mock('@clerk/react', () => ({
  useUser: () => authState,
  useClerk: () => ({ signOut: vi.fn() }),
}));

vi.mock('@/components/auth/ClerkAuthProvider', () => ({
  SignInPage: () => null,
  SignUpPage: () => null,
}));

beforeEach(() => {
  authState.isLoaded = true;
  authState.isSignedIn = true;
  authState.user = {
    id: 'student-test',
    fullName: 'Riley Student',
    primaryEmailAddress: { emailAddress: 'student@example.edu' },
  };
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/sign-up-complete');
});

afterEach(() => {
  cleanup();
  delete window.plausible;
});

describe('successful sign-up analytics', () => {
  it('tracks only after Clerk reports a signed-in session', async () => {
    const track = vi.fn();
    window.plausible = track;
    markSignUpStarted();

    render(<App />);

    await waitFor(() => {
      expect(track).toHaveBeenCalledTimes(1);
      expect(track).toHaveBeenCalledWith('signup_completed');
      expect(window.location.pathname).toBe('/');
    });
  });

  it('does not track when Clerk has not signed the visitor in', async () => {
    const track = vi.fn();
    window.plausible = track;
    authState.isSignedIn = false;
    authState.user = null;

    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe('/sign-up'));
    expect(track).not.toHaveBeenCalled();
  });

  it('does not track a signed-in visitor who did not start a sign-up', async () => {
    const track = vi.fn();
    window.plausible = track;

    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(track).not.toHaveBeenCalled();
  });

  it('does not let an analytics exception interrupt the redirect', async () => {
    window.plausible = () => {
      throw new Error('Analytics unavailable');
    };
    markSignUpStarted();

    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe('/'));
  });

  it('does not count the same completion more than once per browser session', () => {
    const track = vi.fn();
    window.plausible = track;

    markSignUpStarted();
    trackSignUpCompletedOnce();
    trackSignUpCompletedOnce();

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('signup_completed');
  });
});
