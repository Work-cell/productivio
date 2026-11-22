import { useCallback, useEffect, useState } from 'react';
import { useUser } from '@clerk/react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, CheckCircle2, CircleAlert, Loader2, ShieldCheck } from 'lucide-react';
import { BASE_URL } from '@/lib/api-base';

type AuthorizationRequest = {
  requestId: string;
  clientName: string;
  redirectUri: string;
  scopes: string[];
  expiresAt: string;
};

const scopeCopy: Record<string, { title: string; detail: string }> = {
  'planner:read': {
    title: 'Read your planner',
    detail: 'See your tasks, deadlines, calendar events, and projects.',
  },
  'planner:write': {
    title: 'Add and change planner items',
    detail: 'Create tasks and events, and edit or reprioritise existing ones.',
  },
  'planner:delete': {
    title: 'Ask to delete planner items',
    detail: 'Deletions are never applied automatically. You approve each one in Productivio first.',
  },
};

export default function ConnectAiPage() {
  const { isLoaded, isSignedIn } = useUser();
  const [, setLocation] = useLocation();
  const requestId = new URLSearchParams(window.location.search).get('request') ?? '';
  const [request, setRequest] = useState<AuthorizationRequest | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'submitting'>('loading');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!requestId) {
      setStatus('error');
      setError('This connection link is missing. Start again from your AI assistant.');
      return;
    }
    setStatus('loading');
    try {
      const response = await fetch(`${BASE_URL}/oauth/authorize?request_id=${encodeURIComponent(requestId)}`, {
        credentials: 'include',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.error_description === 'string' ? body.error_description : 'This connection request is no longer valid.');
      }
      setRequest(await response.json() as AuthorizationRequest);
      setStatus('ready');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'This connection request could not be loaded.');
      setStatus('error');
    }
  }, [requestId]);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      const next = `${window.location.pathname}${window.location.search}`;
      setLocation(`/sign-in?redirect_url=${encodeURIComponent(next)}`);
      return;
    }
    void load();
  }, [isLoaded, isSignedIn, load, setLocation]);

  const decide = async (decision: 'approve' | 'deny') => {
    if (!request) return;
    setStatus('submitting');
    setError('');
    try {
      const response = await fetch(`${BASE_URL}/oauth/authorize`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: request.requestId, decision }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body.error_description === 'string' ? body.error_description : 'Your decision could not be saved.');
      }
      if (typeof body.redirectTo === 'string') {
        window.location.assign(body.redirectTo);
        return;
      }
      setLocation('/settings');
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : 'Your decision could not be saved.');
      setStatus('ready');
    }
  };

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-background px-5 py-10 text-foreground" data-testid="connect-ai-page">
      <section className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <Link href="/settings" className="mb-6 inline-flex items-center gap-2 text-xs font-bold text-muted-foreground hover:text-foreground">
          <ArrowLeft size={14} />Back to settings
        </Link>

        {status === 'loading' && (
          <div className="flex items-center gap-3 text-sm text-muted-foreground" role="status" data-testid="connect-ai-loading">
            <Loader2 size={18} className="animate-spin" />Checking this connection request…
          </div>
        )}

        {status === 'error' && (
          <div role="alert" className="rounded-xl bg-[#fff2ef] p-4 text-sm text-[#713a34]" data-testid="connect-ai-error">
            <p className="font-bold">This connection could not continue</p>
            <p className="mt-1 leading-relaxed">{error}</p>
            <button type="button" onClick={() => void load()} className="mt-4 rounded-lg bg-[#9d473d] px-3 py-2 text-xs font-bold text-white hover:opacity-90" data-testid="button-reload-connection">
              Try again
            </button>
          </div>
        )}

        {(status === 'ready' || status === 'submitting') && request && (
          <>
            <p className="font-mono-custom text-[10px] uppercase tracking-[.14em] text-primary">Connect an AI assistant</p>
            <h1 className="mt-2 font-display text-2xl font-bold tracking-[-.04em]" data-testid="connect-ai-title">
              Let {request.clientName} work with your planner?
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {request.clientName} will act as you until you disconnect it in Settings. It cannot see another student's planner.
            </p>

            <ul className="mt-5 space-y-3">
              {request.scopes.map(scope => {
                const copy = scopeCopy[scope] ?? { title: scope, detail: '' };
                return (
                  <li key={scope} className="flex items-start gap-3 rounded-xl bg-secondary/60 p-3">
                    <ShieldCheck size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                    <div>
                      <p className="text-sm font-bold">{copy.title}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{copy.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ul>

            <p className="mt-4 rounded-xl bg-[#fff9e9] p-3 text-[11px] leading-relaxed text-[#765d2d]">
              No API key is needed. This uses your signed-in Productivio account, and your AI provider's own subscription is not shared or reused.
            </p>

            {error && <p role="alert" className="mt-3 rounded-lg bg-[#fff2ef] px-3 py-2 text-xs font-semibold text-[#9d473d]" data-testid="connect-ai-decision-error">{error}</p>}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => void decide('deny')}
                disabled={status === 'submitting'}
                className="rounded-xl border border-border px-4 py-2.5 text-sm font-bold text-muted-foreground hover:bg-secondary disabled:opacity-50"
                data-testid="button-deny-connection"
              >
                Don't allow
              </button>
              <button
                type="button"
                onClick={() => void decide('approve')}
                disabled={status === 'submitting'}
                className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-60"
                data-testid="button-approve-connection"
              >
                {status === 'submitting' ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                Allow access
              </button>
            </div>
          </>
        )}

        {status === 'ready' && !request && (
          <p role="alert" className="flex items-start gap-2 text-sm text-muted-foreground">
            <CircleAlert size={16} className="mt-0.5 text-[#9d473d]" />This connection request is no longer available.
          </p>
        )}
      </section>
    </main>
  );
}
