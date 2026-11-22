import { useState, type ReactNode } from 'react';
import BrowserWorkspaceImport from './BrowserWorkspaceImport';

const workspaceKeys = ['tasks', 'events', 'projects', 'focus-mode', 'week-start', 'dense-layout'];
const legacyDecisionKey = 'productivio:browser-workspace-import-v1';

type GateState = 'ready' | 'choice' | 'error';

function studentKey(userId: string, key: string) {
  return `productivio:student:${encodeURIComponent(userId)}:${key}`;
}

function hasStoredValue(keys: string[]) {
  return keys.some(key => window.localStorage.getItem(key) !== null);
}

function initialGateState(userId: string): GateState {
  try {
    const studentKeys = workspaceKeys.map(key => studentKey(userId, key));
    const hasStudentData = hasStoredValue(studentKeys);
    const hasLegacyData = hasStoredValue(workspaceKeys.map(key => `productivio:${key}`));
    const legacyDecision = window.localStorage.getItem(legacyDecisionKey);

    if (hasStudentData) {
      // Existing account data takes precedence. Do not expose an old shared
      // browser planner to another account after this one is already in use.
      if (hasLegacyData && !legacyDecision) {
        window.localStorage.setItem(legacyDecisionKey, JSON.stringify({ userId, decision: 'existing-data' }));
      }
      return 'ready';
    }

    return hasLegacyData && !legacyDecision ? 'choice' : 'ready';
  } catch {
    return 'error';
  }
}

function chooseFresh(userId: string) {
  window.localStorage.setItem(legacyDecisionKey, JSON.stringify({ userId, decision: 'fresh' }));
}

function importLegacyWorkspace(userId: string) {
  const scopedKeys = workspaceKeys.map(key => studentKey(userId, key));
  if (hasStoredValue(scopedKeys)) {
    throw new Error('This account already has planner data. Reload to open that planner safely.');
  }

  const values = workspaceKeys.flatMap(key => {
    const value = window.localStorage.getItem(`productivio:${key}`);
    if (value === null) return [];
    // Validate the entire import before writing any student-scoped values.
    JSON.parse(value);
    return [[studentKey(userId, key), value] as const];
  });

  const writtenKeys: string[] = [];
  try {
    for (const [key, value] of values) {
      window.localStorage.setItem(key, value);
      writtenKeys.push(key);
    }
    window.localStorage.setItem(legacyDecisionKey, JSON.stringify({ userId, decision: 'imported' }));
  } catch (error) {
    for (const key of writtenKeys) window.localStorage.removeItem(key);
    throw error;
  }
}

export default function StudentWorkspaceGate({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<GateState>(() => initialGateState(userId));
  const [error, setError] = useState('');

  if (state === 'error') {
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-background px-5 text-foreground">
        <section className="surface max-w-lg rounded-2xl p-6" role="alert">
          <h1 className="font-display text-xl font-bold">Your planner could not be opened</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Productivio could not read this browser’s saved planner. Check that browser storage is available, then try again.
          </p>
          <button
            type="button"
            onClick={() => {
              setError('');
              setState(initialGateState(userId));
            }}
            className="mt-5 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:opacity-90"
            data-testid="button-retry-open-planner"
          >
            Try again
          </button>
        </section>
      </main>
    );
  }

  if (state === 'choice') {
    return (
      <BrowserWorkspaceImport
        error={error}
        onImport={() => {
          try {
            importLegacyWorkspace(userId);
            setState('ready');
          } catch {
            setError('The planner could not be copied. Your existing browser data was left unchanged; check available storage and try again.');
          }
        }}
        onStartFresh={() => {
          try {
            chooseFresh(userId);
            setState('ready');
          } catch {
            setError('Your choice could not be saved. Check that browser storage is available and try again.');
          }
        }}
      />
    );
  }

  return children;
}
