import { useState } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  CornerDownLeft,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react';
import { createAssistantCommandPlan } from '@workspace/api-client-react';
import type {
  AssistantCommand,
  AssistantCommandPlan,
  AssistantCommandRequestProvider,
  AssistantCommandRequestWeekStart,
  AssistantEventContext,
  AssistantProjectContext,
  AssistantTaskContext,
} from '@workspace/api-client-react';

type Provider = AssistantCommandRequestProvider;

export interface AICommandPanelProps {
  provider: Provider | null;
  apiKey: string;
  onProviderChange: (provider: Provider | null) => void;
  onApiKeyChange: (key: string) => void;
  tasks: AssistantTaskContext[];
  projects: AssistantProjectContext[];
  events: AssistantEventContext[];
  weekStart: AssistantCommandRequestWeekStart;
  onApply: (plan: AssistantCommandPlan) => void | string | Promise<void | string>;
}

const providerNames: Record<Provider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};

function localDateString() {
  const today = new Date();
  const offset = today.getTimezoneOffset();
  return new Date(today.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function quote(value: string) {
  return JSON.stringify(value);
}

function formatTime(minutes: number) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hour >= 12 ? 'pm' : 'am';
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')}${suffix}`;
}

function commandLabel(command: AssistantCommand) {
  switch (command.kind) {
    case 'task.add': return `Add task · ${command.title}`;
    case 'task.update': return `Update task · ${command.id}`;
    case 'task.remove': return `Remove task · ${command.id}`;
    case 'project.add': return `Add project · ${command.name}`;
    case 'project.update': return `Update project · ${command.id}`;
    case 'project.remove': return `Remove project · ${command.id}`;
    case 'event.add': return `Add event · ${command.title}`;
    case 'event.update': return `Update event · ${command.id}`;
    case 'event.remove': return `Remove event · ${command.id}`;
  }
}

function commandPseudoCode(command: AssistantCommand) {
  switch (command.kind) {
    case 'task.add':
      return `task.add({ title: ${quote(command.title)}, dueDate: ${quote(command.dueDate)}${command.category ? `, category: ${quote(command.category)}` : ''}${command.priority ? `, priority: ${quote(command.priority)}` : ''}${command.projectId ? `, projectId: ${quote(command.projectId)}` : ''} })`;
    case 'task.update':
      return `task.update(${quote(command.id)}, ${JSON.stringify(command.changes)})`;
    case 'task.remove':
      return `task.remove(${quote(command.id)})`;
    case 'project.add':
      return `project.add({ name: ${quote(command.name)}${command.description ? `, description: ${quote(command.description)}` : ''} })`;
    case 'project.update':
      return `project.update(${quote(command.id)}, ${JSON.stringify(command.changes)})`;
    case 'project.remove':
      return `project.remove(${quote(command.id)})`;
    case 'event.add':
      return `event.add({ title: ${quote(command.title)}, date: ${quote(command.date)}, time: ${quote(formatTime(command.startMinutes))}–${quote(formatTime(command.endMinutes))}, color: ${quote(command.color)} })`;
    case 'event.update':
      return `event.update(${quote(command.id)}, ${JSON.stringify(command.changes)})`;
    case 'event.remove':
      return `event.remove(${quote(command.id)})`;
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return 'The plan could not be created. Check your connection and try again.';
}

export default function AICommandPanel({
  provider,
  apiKey,
  onProviderChange,
  onApiKeyChange,
  tasks,
  projects,
  events,
  weekStart,
  onApply,
}: AICommandPanelProps) {
  const [prompt, setPrompt] = useState('');
  const [keyDraft, setKeyDraft] = useState(apiKey);
  const [plan, setPlan] = useState<AssistantCommandPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const connected = Boolean(provider && apiKey);
  const canPlan = connected && prompt.trim().length > 0 && !busy && !applying;

  const changeProvider = (next: Provider | '') => {
    setPlan(null);
    setError('');
    setNotice('');
    if (next !== provider) {
      onApiKeyChange('');
      setKeyDraft('');
    }
    onProviderChange(next || null);
  };

  const connect = () => {
    setError('');
    setNotice('');
    if (!provider) {
      setError('Choose OpenAI or Anthropic before connecting.');
      return;
    }
    if (keyDraft.trim().length < 20) {
      setError('Enter a valid API key (at least 20 characters).');
      return;
    }
    onApiKeyChange(keyDraft.trim());
    setNotice(`${providerNames[provider]} is connected for this session.`);
  };

  const disconnect = () => {
    onApiKeyChange('');
    setKeyDraft('');
    setPlan(null);
    setError('');
    setNotice('Key removed from this session.');
  };

  const createPlan = async () => {
    if (!provider || !apiKey) {
      setError('Connect a provider before creating a plan.');
      return;
    }
    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt.length < 1 || trimmedPrompt.length > 1200) {
      setError('Your request must be between 1 and 1,200 characters.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    setPlan(null);
    try {
      const response = await createAssistantCommandPlan({
        provider,
        apiKey,
        prompt: trimmedPrompt,
        today: localDateString(),
        weekStart,
        tasks,
        projects,
        events,
      });
      setPlan(response);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  };

  const applyPlan = async () => {
    if (!plan || applying) return;
    setApplying(true);
    setError('');
    try {
      const result = await onApply(plan);
      if (typeof result === 'string' && result) {
        setError(result);
        return;
      }
      setPlan(null);
      setPrompt('');
      setNotice('Approved changes are now in your planner.');
    } catch (applyError) {
      setError(getErrorMessage(applyError));
    } finally {
      setApplying(false);
    }
  };

  const cancelPlan = () => {
    setPlan(null);
    setError('');
    setNotice('Plan cancelled. Nothing was changed.');
  };

  return (
    <section className="overflow-hidden rounded-[22px] border border-[#d8d5c9] bg-[#fdfcf8] shadow-[0_18px_50px_rgba(45,55,49,.09)]" aria-labelledby="ai-command-title">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e7e4da] bg-[#f4f2e9] px-5 py-4 sm:px-7">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#203a37] text-[#c6eadf]"><Terminal size={19} aria-hidden="true" /></span>
          <div>
            <p className="font-mono-custom text-[10px] font-medium uppercase tracking-[.15em] text-[#58706a]">Planner assistant / preview mode</p>
            <h2 id="ai-command-title" className="font-display text-lg font-bold tracking-[-.035em] text-[#263a37]">AI command panel</h2>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#c8d9cf] bg-[#e9f3ec] px-3 py-1.5 font-mono-custom text-[10px] uppercase tracking-[.08em] text-[#3d6c5d]">
          <ShieldCheck size={13} aria-hidden="true" /> Review before apply
        </span>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.05fr)_minmax(300px,.95fr)]">
        <div className="space-y-6 px-5 py-6 sm:px-7">
          <div className="space-y-2">
            <label htmlFor="assistant-provider" className="block text-xs font-bold text-[#394945]">AI provider</label>
            <div className="relative">
              <select
                id="assistant-provider"
                value={provider ?? ''}
                onChange={event => changeProvider(event.target.value as Provider | '')}
                disabled={busy || applying}
                className="h-11 w-full appearance-none rounded-xl border border-[#dcd9cf] bg-[#fffefa] px-3.5 pr-10 text-sm font-semibold text-[#344641] outline-none transition focus:border-[#538d7e] focus:ring-4 focus:ring-[#538d7e]/10 disabled:opacity-60"
              >
                <option value="">Choose a provider</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
              </select>
              <ChevronDown size={16} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[#78837d]" aria-hidden="true" />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-end justify-between gap-3">
              <label htmlFor="assistant-api-key" className="block text-xs font-bold text-[#394945]">Provider API key</label>
              {connected && <span className="flex items-center gap-1 font-mono-custom text-[10px] text-[#3d7868]"><CheckCircle2 size={12} /> Connected in memory</span>}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative min-w-0 flex-1">
                <KeyRound size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8a958d]" aria-hidden="true" />
                <input
                  id="assistant-api-key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={keyDraft}
                  onChange={event => setKeyDraft(event.target.value)}
                  placeholder={provider === 'anthropic' ? 'sk-ant-…' : provider === 'openai' ? 'sk-…' : 'Choose a provider first'}
                  disabled={!provider || connected || busy || applying}
                  aria-describedby="assistant-key-note"
                  className="h-11 w-full rounded-xl border border-[#dcd9cf] bg-[#fffefa] pl-10 pr-3 text-sm outline-none transition placeholder:text-[#a0a49a] focus:border-[#538d7e] focus:ring-4 focus:ring-[#538d7e]/10 disabled:opacity-55"
                />
              </div>
              {connected ? (
                <button type="button" onClick={disconnect} disabled={busy || applying} className="h-11 shrink-0 rounded-xl border border-[#ddd9cf] px-4 text-xs font-bold text-[#68736d] transition hover:border-[#c98e80] hover:bg-[#fff3ef] hover:text-[#9c5145] disabled:opacity-50">
                  Disconnect
                </button>
              ) : (
                <button type="button" onClick={connect} disabled={!provider || !keyDraft.trim() || busy || applying} className="h-11 shrink-0 rounded-xl bg-[#2b6258] px-4 text-xs font-bold text-white transition hover:bg-[#214f47] disabled:cursor-not-allowed disabled:opacity-45">
                  Connect
                </button>
              )}
            </div>
            <p id="assistant-key-note" className="text-[11px] leading-relaxed text-[#81877f]">Your key stays in parent-provided memory only. It is never saved to browser storage.</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="assistant-prompt" className="block text-xs font-bold text-[#394945]">What should change in your planner?</label>
              <span className={`font-mono-custom text-[10px] ${prompt.length > 1200 ? 'text-[#a34c40]' : 'text-[#89918a]'}`}>{prompt.length}/1,200</span>
            </div>
            <textarea
              id="assistant-prompt"
              value={prompt}
              onChange={event => {
                setPrompt(event.target.value);
                setPlan(null);
                setError('');
              }}
              maxLength={1400}
              rows={5}
              placeholder="For example: Add a 45-minute biology review on Thursday, and move my essay draft to Friday."
              disabled={busy || applying}
              className="w-full resize-y rounded-xl border border-[#dcd9cf] bg-[#fffefa] px-4 py-3 text-sm leading-relaxed text-[#344641] outline-none transition placeholder:text-[#a0a49a] focus:border-[#538d7e] focus:ring-4 focus:ring-[#538d7e]/10 disabled:opacity-60"
            />
            <p className="text-[11px] text-[#81877f]">Ask for changes to tasks, projects, or events. You’ll review every command before anything is applied.</p>
          </div>

          <button
            type="button"
            onClick={() => void createPlan()}
            disabled={!canPlan}
            className="group flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#203a37] px-4 text-sm font-bold text-[#f6f5ee] transition hover:bg-[#2a4d47] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#538d7e]/25 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busy ? <><span className="h-4 w-4 animate-pulse rounded-full border-2 border-[#d0e5da] border-t-transparent" aria-hidden="true" />Building a reviewable plan…</> : <><Sparkles size={16} aria-hidden="true" />Create command plan<CornerDownLeft size={14} className="ml-1 opacity-60" aria-hidden="true" /></>}
          </button>
        </div>

        <aside className="border-t border-[#e7e4da] bg-[#f8f7f1] px-5 py-6 sm:px-7 lg:border-l lg:border-t-0" aria-label="Command plan preview">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="font-mono-custom text-[10px] uppercase tracking-[.15em] text-[#738079]">Output / constrained actions</p>
              <h3 className="mt-1 font-display text-lg font-bold tracking-[-.035em] text-[#2c403b]">Plan preview</h3>
            </div>
            {plan && <span className="rounded-md bg-[#e2eee7] px-2 py-1 font-mono-custom text-[10px] text-[#426c5c]">{plan.commands.length} {plan.commands.length === 1 ? 'command' : 'commands'}</span>}
          </div>

          {busy ? (
            <div className="space-y-3" role="status" aria-live="polite" aria-label="Creating a command plan">
              <div className="h-4 w-3/4 animate-pulse rounded bg-[#e9e7de]" />
              <div className="h-24 animate-pulse rounded-xl border border-[#e5e2d8] bg-[#efeee7]" />
              <div className="h-16 animate-pulse rounded-xl border border-[#e5e2d8] bg-[#efeee7]" />
            </div>
          ) : plan ? (
            <div className="animate-in">
              <div className="mb-4 rounded-xl border border-[#d9e3d9] bg-[#f0f6ef] p-4">
                <p className="mb-1 font-mono-custom text-[9px] uppercase tracking-[.13em] text-[#688071]">Assistant summary</p>
                <p className="text-sm leading-relaxed text-[#344b40]">{plan.summary}</p>
              </div>
              <ol className="space-y-2.5">
                {plan.commands.map((command, index) => (
                  <li key={`${command.kind}-${index}`} className="overflow-hidden rounded-xl border border-[#dcd9cf] bg-[#fffefa]">
                    <div className="flex items-center gap-2 border-b border-[#eeece4] px-3.5 py-2.5">
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-[#e8efe9] font-mono-custom text-[10px] font-medium text-[#3a6b5d]">{String(index + 1).padStart(2, '0')}</span>
                      <span className="min-w-0 truncate text-xs font-bold text-[#45534c]">{commandLabel(command)}</span>
                    </div>
                    <pre className="overflow-x-auto px-3.5 py-3 font-mono-custom text-[11px] leading-relaxed text-[#536a60]"><code>{commandPseudoCode(command)}</code></pre>
                  </li>
                ))}
              </ol>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <button type="button" onClick={cancelPlan} disabled={applying} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-[#d7d5cc] bg-[#fffefa] text-xs font-bold text-[#65716a] transition hover:border-[#c7a49b] hover:bg-[#fff5f1] hover:text-[#9c5145] disabled:opacity-50">
                  <X size={14} aria-hidden="true" />Cancel
                </button>
                <button type="button" onClick={() => void applyPlan()} disabled={applying} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#397a64] text-xs font-bold text-white transition hover:bg-[#2e6955] disabled:cursor-wait disabled:opacity-60">
                  {applying ? <><span className="h-3.5 w-3.5 animate-pulse rounded-full border-2 border-white border-t-transparent" aria-hidden="true" />Applying…</> : <><Check size={15} aria-hidden="true" />Apply changes</>}
                </button>
              </div>
              <p className="mt-3 text-center text-[10px] leading-relaxed text-[#828981]">Nothing changes until you choose Apply changes.</p>
            </div>
          ) : (
            <div className="flex min-h-[250px] flex-col items-center justify-center rounded-xl border border-dashed border-[#d9d8cf] bg-[#fbfaf5] px-6 py-8 text-center">
              <span className="mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-[#e9eee6] text-[#557568]"><Terminal size={19} aria-hidden="true" /></span>
              <p className="text-sm font-bold text-[#46544c]">Your plan will appear here</p>
              <p className="mt-1.5 max-w-[250px] text-xs leading-relaxed text-[#858b83]">The assistant can only suggest planner commands. Review them line by line before applying.</p>
              <div className="mt-5 flex items-center gap-1.5 rounded-full bg-[#f0eee6] px-3 py-1.5 font-mono-custom text-[9px] uppercase tracking-[.08em] text-[#767e75]"><LockKeyhole size={11} />No arbitrary code execution</div>
            </div>
          )}

          {(error || notice) && (
            <div className={`mt-4 flex items-start gap-2.5 rounded-xl border p-3 text-xs leading-relaxed ${error ? 'border-[#e7c7be] bg-[#fff2ee] text-[#93483e]' : 'border-[#c9dfd0] bg-[#edf6ee] text-[#3e705c]'}`} role={error ? 'alert' : 'status'} aria-live="polite">
              {error ? <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> : <CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden="true" />}
              <span>{error || notice}</span>
            </div>
          )}
        </aside>
      </div>

      <footer className="border-t border-[#e7e4da] bg-[#f5f3eb] px-5 py-4 sm:px-7">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#e3e9df] text-[#557568]"><CircleHelp size={15} aria-hidden="true" /></span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-[#4b5a50]">Privacy & provider billing</p>
            <p className="mt-1 max-w-4xl text-[11px] leading-relaxed text-[#777f76]">
              Your prompt and current planner data are sent through Productivio’s API to the selected provider to create this plan. Productivio does not save your key or prompt; the provider may apply its own retention policy. Provider costs are billed by your provider.
            </p>
          </div>
          <ArrowUpRight size={14} className="mt-1 hidden shrink-0 text-[#9aa097] sm:block" aria-hidden="true" />
        </div>
      </footer>
    </section>
  );
}
