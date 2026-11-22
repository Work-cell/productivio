import { ArrowRight, BookOpen, LockKeyhole } from 'lucide-react';

type BrowserWorkspaceImportProps = {
  error?: string;
  onImport: () => void;
  onStartFresh: () => void;
};

export default function BrowserWorkspaceImport({
  error,
  onImport,
  onStartFresh,
}: BrowserWorkspaceImportProps) {
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-background px-5 py-10 text-foreground">
      <section className="surface w-full max-w-xl rounded-3xl p-6 shadow-xl shadow-foreground/5 sm:p-9" aria-labelledby="workspace-import-title">
        <span className="mb-6 grid h-12 w-12 place-items-center rounded-2xl bg-secondary text-primary">
          <BookOpen size={22} aria-hidden="true" />
        </span>
        <p className="font-mono-custom text-[10px] uppercase tracking-[.16em] text-primary">
          One choice before you begin
        </p>
        <h1 id="workspace-import-title" className="mt-3 font-display text-3xl font-bold leading-tight tracking-[-.05em]">
          A planner is saved in this browser
        </h1>
        <p className="mt-4 text-sm leading-7 text-muted-foreground">
          It was created before you signed in. You can copy its tasks, calendar, and projects into this planner, or start with a clean one.
        </p>

        <div className="mt-6 flex gap-3 rounded-2xl border border-border bg-secondary/60 p-4">
          <LockKeyhole size={17} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Planner details are not uploaded or synced. Any copy stays in this browser.
          </p>
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs leading-relaxed text-destructive">
            {error}
          </p>
        )}

        <div className="mt-7 flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onStartFresh}
            className="min-h-11 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-bold text-foreground transition-colors hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            data-testid="button-start-fresh"
          >
            Start fresh
          </button>
          <button
            type="button"
            onClick={onImport}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            data-testid="button-import-browser-workspace"
          >
            Copy into this planner <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
      </section>
    </main>
  );
}
