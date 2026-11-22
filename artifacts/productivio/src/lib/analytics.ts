type PlausibleOptions = {
  props?: Record<string, string | number | boolean>;
  interactive?: boolean;
};

type Plausible = (eventName: string, options?: PlausibleOptions) => void;

declare global {
  interface Window {
    plausible?: Plausible & { q?: IArguments[] };
  }
}

const signupAttemptKey = 'productivio:analytics:signup-attempt';

export function initializeAnalytics() {
  if (typeof window === 'undefined' || !import.meta.env.PROD) return;

  try {
    if (!window.plausible) {
      const plausibleStub = function (
        this: Window,
        _eventName: string,
        _options?: PlausibleOptions,
      ) {
        (plausibleStub.q ??= []).push(arguments);
      } as Plausible & { q?: IArguments[] };
      window.plausible = plausibleStub;
    }

    if (document.getElementById('productivio-plausible')) return;

    const script = document.createElement('script');
    script.id = 'productivio-plausible';
    script.defer = true;
    script.dataset.domain = window.location.hostname;
    script.src = 'https://plausible.io/js/script.manual.js';
    document.head.appendChild(script);
  } catch {
    // Analytics must never interrupt sign-up or authentication.
  }
}

export function markSignUpStarted() {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.setItem(signupAttemptKey, 'pending');
  } catch {
    // Tracking is skipped when an attempt cannot be recorded safely.
  }
}

export function clearSignUpAttempt() {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.removeItem(signupAttemptKey);
  } catch {
    // Authentication must continue when browser storage is unavailable.
  }
}

export function trackSignUpCompletedOnce() {
  if (typeof window === 'undefined') return;

  try {
    if (window.sessionStorage.getItem(signupAttemptKey) !== 'pending') return;
    window.sessionStorage.removeItem(signupAttemptKey);
  } catch {
    return;
  }

  try {
    window.plausible?.('signup_completed');
  } catch {
    // Analytics must never interrupt sign-up or authentication.
  }
}
