import { useCallback, useEffect, useState } from 'react';
import { Bot, CircleAlert, Loader2, Plug, ShieldCheck, Trash2 } from 'lucide-react';
import { BASE_URL } from '@/lib/api-base';

type Connection = {
  id: string;
  clientName: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type DeletionRequest = {
  id: string;
  kind: 'task' | 'event' | 'project';
  targetId: string;
  title: string;
  createdAt: string;
};

const scopeLabels: Record<string, string> = {
  'planner:read': 'Read planner',
  'planner:write': 'Add & edit',
  'planner:delete': 'Request deletions',
};

const formatWhen = (value: string | null) => {
  if (!value) return 'Never used';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/**
 * Lets a student review connected AI assistants and approve or deny the
 * deletions those assistants have requested. Every call is scoped by the
 * student's own session on the server.
 */
export default function AiIntegrationsSettings({
  mcpUrl,
  onPlannerChanged,
}: {
  mcpUrl: string;
  onPlannerChanged?: () => void;
}) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [requests, setRequests] = useState<DeletionRequest[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const [connectionsResponse, requestsResponse] = await Promise.all([
        fetch(`${BASE_URL}/api/integrations`, { credentials: 'include' }),
        fetch(`${BASE_URL}/api/deletion-requests`, { credentials: 'include' }),
      ]);
      if (!connectionsResponse.ok || !requestsResponse.ok) throw new Error('Could not load connected assistants.');
      const connectionsBody = await connectionsResponse.json() as { connections: Connection[] };
      const requestsBody = await requestsResponse.json() as { requests: DeletionRequest[] };
      setConnections(connectionsBody.connections.filter(connection => !connection.revokedAt));
      setRequests(requestsBody.requests);
      setStatus('ready');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load connected assistants.');
      setStatus('error');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const disconnect = async (connection: Connection) => {
    setBusyId(connection.id);
    setNotice('');
    try {
      const response = await fetch(`${BASE_URL}/api/integrations/${encodeURIComponent(connection.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('This assistant could not be disconnected. Try again.');
      setConnections(current => current.filter(item => item.id !== connection.id));
      setNotice(`${connection.clientName} can no longer open your planner.`);
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : 'This assistant could not be disconnected.');
    } finally {
      setBusyId('');
    }
  };

  const decide = async (request: DeletionRequest, decision: 'approve' | 'deny') => {
    setBusyId(request.id);
    setNotice('');
    try {
      const response = await fetch(`${BASE_URL}/api/deletion-requests/${encodeURIComponent(request.id)}/${decision}`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('That request could not be updated. Reload and try again.');
      setRequests(current => current.filter(item => item.id !== request.id));
      setNotice(decision === 'approve'
        ? `Deleted "${request.title}".`
        : `Kept "${request.title}".`);
      if (decision === 'approve') onPlannerChanged?.();
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : 'That request could not be updated.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div data-testid="ai-integrations-settings">
      <div className="flex items-center gap-3 rounded-xl bg-secondary/60 p-4">
        <Bot size={18} className="shrink-0 text-primary" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Connect ChatGPT, Claude, or another AI assistant that supports MCP. You approve access here, no API key is needed, and you can disconnect at any time.
        </p>
      </div>

      <div className="mt-3 rounded-xl border border-border bg-background p-3">
        <p className="text-[11px] font-bold">Server address for your AI assistant</p>
        <code className="mt-1.5 block select-all break-all rounded-lg bg-secondary/70 px-2.5 py-2 font-mono-custom text-[10px] text-foreground" data-testid="text-mcp-url">
          {mcpUrl}
        </code>
        <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
          Paste this where your assistant asks for a remote MCP server or connector URL. It will send you back here to approve access.
        </p>
      </div>

      {status === 'loading' && (
        <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2 size={14} className="animate-spin" />Loading connected assistants…
        </p>
      )}

      {status === 'error' && (
        <div role="alert" className="mt-4 flex items-start gap-2 rounded-lg bg-[#fff2ef] px-3 py-2 text-xs font-semibold text-[#9d473d]" data-testid="text-integrations-error">
          <CircleAlert size={14} className="mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => void load()} className="underline" data-testid="button-reload-integrations">Retry</button>
        </div>
      )}

      {notice && <p role="status" className="mt-3 rounded-lg bg-[#e9f6f1] px-3 py-2 text-xs font-semibold text-[#236d60]" data-testid="text-integrations-notice">{notice}</p>}

      {status === 'ready' && (
        <>
          <p className="mt-5 text-[11px] font-bold uppercase tracking-[.1em] text-muted-foreground">Connected assistants</p>
          {connections.length ? (
            <ul className="mt-2 space-y-2">
              {connections.map(connection => (
                <li key={connection.id} className="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`connection-${connection.id}`}>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-sm font-bold"><Plug size={13} className="text-primary" />{connection.clientName}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Connected {formatWhen(connection.createdAt)} · Last used {formatWhen(connection.lastUsedAt).toLowerCase()}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {connection.scopes.map(scope => (
                        <span key={scope} className="rounded bg-secondary px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">{scopeLabels[scope] ?? scope}</span>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void disconnect(connection)}
                    disabled={busyId === connection.id}
                    className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[#e7b2a9] bg-[#fff2ef] px-3 py-2 text-[11px] font-bold text-[#9d473d] hover:bg-[#ffe7e2] disabled:opacity-50"
                    data-testid={`button-disconnect-${connection.id}`}
                  >
                    {busyId === connection.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    Disconnect
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 rounded-xl bg-secondary/40 px-3 py-3 text-xs text-muted-foreground" data-testid="text-no-connections">
              No AI assistants are connected right now.
            </p>
          )}

          <p className="mt-5 text-[11px] font-bold uppercase tracking-[.1em] text-muted-foreground">Deletions waiting for you</p>
          {requests.length ? (
            <ul className="mt-2 space-y-2">
              {requests.map(request => (
                <li key={request.id} className="rounded-xl border border-[#ead8a8] bg-[#fff9e9] p-3" data-testid={`deletion-request-${request.id}`}>
                  <p className="text-xs font-bold text-[#5c4a22]">Delete {request.kind}: “{request.title}”</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-[#765d2d]">An AI assistant asked to remove this. Nothing is deleted until you choose.</p>
                  <div className="mt-2.5 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void decide(request, 'deny')}
                      disabled={busyId === request.id}
                      className="rounded-lg border border-border bg-card px-3 py-1.5 text-[11px] font-bold text-muted-foreground hover:bg-secondary disabled:opacity-50"
                      data-testid={`button-keep-${request.id}`}
                    >
                      Keep it
                    </button>
                    <button
                      type="button"
                      onClick={() => void decide(request, 'approve')}
                      disabled={busyId === request.id}
                      className="flex items-center gap-1.5 rounded-lg bg-[#a3443e] px-3 py-1.5 text-[11px] font-bold text-white hover:opacity-90 disabled:opacity-50"
                      data-testid={`button-approve-deletion-${request.id}`}
                    >
                      {busyId === request.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 rounded-xl bg-secondary/40 px-3 py-3 text-xs text-muted-foreground" data-testid="text-no-deletions">
              Nothing is waiting for approval.
            </p>
          )}

          <p className="mt-4 flex items-start gap-2 text-[10px] leading-relaxed text-muted-foreground">
            <ShieldCheck size={13} className="mt-0.5 shrink-0 text-primary" />
            Connected assistants only ever see your own planner. Disconnecting stops access immediately.
          </p>
        </>
      )}
    </div>
  );
}
