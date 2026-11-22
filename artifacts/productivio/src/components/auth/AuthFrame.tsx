import type { ReactNode } from 'react';
import { BookOpen, Check, Clock3, Target } from 'lucide-react';

type AuthFrameProps = {
  mode: 'sign-in' | 'sign-up';
  children: ReactNode;
};

const schedule = [
  { time: '09:00', title: 'Statistics · problem set', duration: '45 min', active: true },
  { time: '10:00', title: 'A real break', duration: '15 min', active: false },
  { time: '10:15', title: 'Urban ecologies · ch. 6', duration: '35 min', active: false },
];

export default function AuthFrame({ mode, children }: AuthFrameProps) {
  const isSignUp = mode === 'sign-up';

  return (
    <main className="min-h-[100dvh] bg-background text-foreground md:grid md:grid-cols-[minmax(300px,0.92fr)_minmax(440px,1.08fr)]">
      <aside className="relative hidden min-h-[100dvh] overflow-hidden bg-sidebar px-10 py-9 text-sidebar-foreground md:flex md:flex-col lg:px-14">
        <div aria-hidden="true" className="dot-grid pointer-events-none absolute inset-0 opacity-[.16]" />
        <div aria-hidden="true" className="absolute -right-28 top-[18%] h-80 w-80 rounded-full border border-sidebar-foreground/10" />
        <div aria-hidden="true" className="absolute -right-12 top-[24%] h-48 w-48 rounded-full border border-sidebar-primary/20" />

        <div className="relative flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-[14px] bg-sidebar-primary text-sidebar-primary-foreground">
            <Target size={20} strokeWidth={2.4} aria-hidden="true" />
          </span>
          <span className="font-display text-[20px] font-bold tracking-[-.045em]">Productivio</span>
        </div>

        <div className="relative my-auto max-w-[480px] py-14">
          <p className="mb-5 flex items-center gap-2 font-mono-custom text-[10px] uppercase tracking-[.18em] text-sidebar-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-sidebar-primary" />
            A little more room to think
          </p>
          <h1 className="font-display text-4xl font-bold leading-[1.08] tracking-[-.06em] text-[#f4f0e5] lg:text-[52px]">
            Make a plan
            <br />
            that fits your
            <br />
            <span className="text-sidebar-primary">actual day.</span>
          </h1>
          <p className="mt-5 max-w-[370px] text-sm leading-7 text-sidebar-foreground/65">
            Keep coursework, project progress, and study time in one thoughtful place.
          </p>

          <div className="mt-10 max-w-[390px] rounded-2xl border border-sidebar-foreground/10 bg-sidebar-accent/65 p-4 shadow-2xl shadow-[#111923]/20">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-sidebar-primary/15 text-sidebar-primary">
                  <BookOpen size={16} aria-hidden="true" />
                </span>
                <div>
                  <p className="text-xs font-bold text-sidebar-accent-foreground">Tuesday, in focus</p>
                  <p className="mt-0.5 font-mono-custom text-[9px] text-sidebar-foreground/50">A STUDY PLAN THAT BREATHES</p>
                </div>
              </div>
              <Clock3 size={15} className="text-sidebar-foreground/45" aria-hidden="true" />
            </div>
            <div className="space-y-1.5">
              {schedule.map((item) => (
                <div
                  key={item.time}
                  className={`flex items-center gap-3 rounded-xl px-2.5 py-2.5 ${
                    item.active ? 'bg-sidebar-primary/10' : ''
                  }`}
                >
                  <span className="w-10 shrink-0 font-mono-custom text-[10px] text-sidebar-foreground/55">{item.time}</span>
                  <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${item.active ? 'border-sidebar-primary bg-sidebar-primary text-sidebar-primary-foreground' : 'border-sidebar-foreground/25'}`}>
                    {item.active && <Check size={10} strokeWidth={3} aria-hidden="true" />}
                  </span>
                  <span className={`min-w-0 flex-1 truncate text-[11px] font-semibold ${item.active ? 'text-sidebar-accent-foreground' : 'text-sidebar-foreground/65'}`}>
                    {item.title}
                  </span>
                  <span className="font-mono-custom text-[9px] text-sidebar-foreground/40">{item.duration}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2 border-t border-sidebar-foreground/10 pt-3">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-sidebar-foreground/10">
                <span className="block h-full w-[38%] rounded-full bg-sidebar-primary" />
              </span>
              <span className="font-mono-custom text-[9px] text-sidebar-foreground/50">38% of today</span>
            </div>
          </div>
        </div>

        <p className="relative font-mono-custom text-[9px] uppercase tracking-[.14em] text-sidebar-foreground/35">
          Your studies, at your pace
        </p>
      </aside>

      <section className="flex min-h-[100dvh] min-w-0 flex-col md:max-h-[100dvh] md:overflow-y-auto">
        <header className="flex items-center justify-between px-5 pb-2 pt-6 sm:px-9 sm:pt-8 md:px-10 lg:px-14">
          <div className="flex items-center gap-2.5 md:hidden">
            <span className="grid h-8 w-8 place-items-center rounded-[11px] bg-primary text-primary-foreground">
              <Target size={17} strokeWidth={2.4} aria-hidden="true" />
            </span>
            <span className="font-display text-lg font-bold tracking-[-.045em]">Productivio</span>
          </div>
          <span className="hidden font-mono-custom text-[10px] uppercase tracking-[.14em] text-muted-foreground md:block">
            {isSignUp ? 'A good place to begin' : 'Pick up where you left off'}
          </span>
          <span className="ml-auto rounded-full border border-border bg-card px-3 py-1.5 font-mono-custom text-[9px] uppercase tracking-[.11em] text-muted-foreground">
            {isSignUp ? 'Your next chapter' : 'Welcome back'}
          </span>
        </header>

        <div className="flex flex-1 items-start justify-center px-4 pb-8 pt-5 sm:px-8 sm:pt-8 md:items-center md:px-10 md:py-10 lg:px-14">
          <div
            className="w-full max-w-[440px] [&_*:focus-visible]:outline [&_*:focus-visible]:outline-2 [&_*:focus-visible]:outline-offset-2 [&_*:focus-visible]:outline-primary"
            data-testid={`auth-frame-${mode}`}
          >
            <div className="mb-6 md:hidden">
              <p className="mb-2 font-mono-custom text-[9px] uppercase tracking-[.16em] text-primary">
                {isSignUp ? 'Start with a clear page' : 'Your day is waiting'}
              </p>
              <h1 className="font-display text-2xl font-bold leading-tight tracking-[-.05em]">
                {isSignUp ? 'Make space for what matters.' : 'Good to have you back.'}
              </h1>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                {isSignUp
                  ? 'Bring your coursework and study time into a plan that feels doable.'
                  : 'Your coursework, projects, and study plan are right where you left them.'}
              </p>
            </div>
            {children}
            <p className="mt-6 text-center text-[11px] leading-relaxed text-muted-foreground">
              A steadier way to study, one focused block at a time.
            </p>
          </div>
        </div>

        <footer className="px-5 pb-5 text-center font-mono-custom text-[9px] uppercase tracking-[.12em] text-muted-foreground/65 sm:px-9 md:px-10 lg:px-14">
          Made for your student life
        </footer>
      </section>
    </main>
  );
}
