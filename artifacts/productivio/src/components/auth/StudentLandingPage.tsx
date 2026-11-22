import { ArrowRight, BookOpen, CalendarDays, CheckSquare2, Target } from 'lucide-react';
import { Link } from 'wouter';

const features = [
  {
    icon: CheckSquare2,
    title: 'Turn work into next steps',
    description: 'Keep assignments, due dates, and priorities in one personal task list.',
  },
  {
    icon: CalendarDays,
    title: 'Make time for studying',
    description: 'Place study blocks and class commitments on a schedule that fits your day.',
  },
  {
    icon: BookOpen,
    title: 'See project progress clearly',
    description: 'Track longer coursework projects using the tasks you have actually completed.',
  },
];

export default function StudentLandingPage({
  onContinueAsGuest,
  guestError,
}: {
  onContinueAsGuest: () => void;
  guestError?: string;
}) {
  return (
    <main className="min-h-[100dvh] bg-background text-foreground">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-12">
        <Link href="/" className="flex items-center gap-3 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
          <span className="grid h-10 w-10 place-items-center rounded-[14px] bg-primary text-primary-foreground">
            <Target size={20} strokeWidth={2.4} aria-hidden="true" />
          </span>
          <span className="font-display text-xl font-bold tracking-[-.045em]">Productivio</span>
        </Link>
        <nav className="flex items-center gap-2 sm:gap-3" aria-label="Account">
          <Link href="/sign-in" className="whitespace-nowrap rounded-xl px-3 py-2.5 text-xs font-bold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:px-4 sm:text-sm">
            Sign in
          </Link>
          <Link href="/sign-up" className="inline-flex items-center gap-2 whitespace-nowrap rounded-xl bg-primary px-3.5 py-2.5 text-xs font-bold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:px-4 sm:text-sm">
            <span className="sm:hidden">Sign up</span>
            <span className="hidden sm:inline">Create account</span>
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </nav>
      </header>

      <section className="mx-auto grid max-w-7xl gap-12 px-5 pb-14 pt-10 sm:px-8 sm:pb-20 sm:pt-16 lg:grid-cols-[1.05fr_.95fr] lg:items-center lg:px-12 lg:pb-24 lg:pt-20">
        <div>
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 font-mono-custom text-[10px] uppercase tracking-[.14em] text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            A personal planner for students
          </p>
          <h1 className="max-w-2xl font-display text-4xl font-bold leading-[1.04] tracking-[-.06em] sm:text-5xl lg:text-6xl">
            Make a plan that fits your <span className="text-primary">actual day.</span>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            Keep coursework, projects, and study time in one thoughtful place—without turning student life into another team dashboard.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/sign-up" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              Create your account <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link href="/sign-in" className="inline-flex min-h-12 items-center rounded-xl border border-border bg-card px-5 py-3 text-sm font-bold text-foreground transition-colors hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              I already have an account
            </Link>
            <button
              type="button"
              onClick={onContinueAsGuest}
              className="inline-flex min-h-12 items-center rounded-xl border border-dashed border-primary/40 bg-transparent px-5 py-3 text-sm font-bold text-primary transition-colors hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              data-testid="button-continue-as-guest"
            >
              Continue without an account
            </button>
          </div>
          {guestError && (
            <p role="alert" className="mt-4 max-w-xl rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs leading-relaxed text-destructive">
              {guestError}
            </p>
          )}
          <p className="mt-3 max-w-xl text-xs leading-relaxed text-muted-foreground">
            Guest planner data stays in this browser and is not password-protected. Anyone with access to this browser may open it.
          </p>
        </div>

        <div className="relative">
          <div aria-hidden="true" className="absolute -inset-5 rounded-[2rem] bg-primary/5 blur-2xl" />
          <div className="surface relative rounded-[1.75rem] p-5 shadow-xl shadow-foreground/5 sm:p-7">
            <div className="flex items-center justify-between gap-4 border-b border-border pb-5">
              <div>
                <p className="font-mono-custom text-[9px] uppercase tracking-[.15em] text-muted-foreground">A little more room to think</p>
                <h2 className="mt-1 font-display text-xl font-bold tracking-[-.04em]">Your week, in focus</h2>
              </div>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
                <BookOpen size={19} aria-hidden="true" />
              </span>
            </div>
            <div className="space-y-3 py-5">
              {[
                ['09:00', 'Statistics problem set', '45 min'],
                ['10:00', 'A real break', '15 min'],
                ['10:15', 'Urban ecologies · ch. 6', '35 min'],
              ].map(([time, title, duration], index) => (
                <div key={time} className={`flex items-center gap-3 rounded-xl px-3 py-3 ${index === 0 ? 'bg-secondary/75' : ''}`}>
                  <span className="w-11 shrink-0 font-mono-custom text-[10px] text-muted-foreground">{time}</span>
                  <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${index === 0 ? 'border-primary bg-primary' : 'border-border'}`}>
                    {index === 0 && <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold">{title}</span>
                  <span className="font-mono-custom text-[9px] text-muted-foreground">{duration}</span>
                </div>
              ))}
            </div>
            <p className="border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
              A sample study plan, made to leave space for the rest of your day.
            </p>
          </div>
        </div>
      </section>

      <section className="border-y border-border/80 bg-card/60">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 sm:grid-cols-3 sm:px-8 sm:py-12 lg:px-12">
          {features.map(({ icon: Icon, title, description }) => (
            <article key={title} className="flex gap-4">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
                <Icon size={18} aria-hidden="true" />
              </span>
              <div>
                <h2 className="font-display text-sm font-bold tracking-[-.02em]">{title}</h2>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <footer className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
        <span>Made for your student life.</span>
        <span>Planner details stay in this browser; signing in does not upload or sync them.</span>
      </footer>
    </main>
  );
}
