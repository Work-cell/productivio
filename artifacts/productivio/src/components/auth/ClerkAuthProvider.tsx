import { useEffect, type ReactNode } from 'react';
import { ClerkProvider, SignIn, SignUp, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { useLocation } from 'wouter';
import AuthFrame from './AuthFrame';
import { clearSignUpAttempt, markSignUpStarted } from '@/lib/analytics';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPublishableKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

if (!clerkPublishableKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY.');
}

function stripBase(path: string) {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#287867',
    colorForeground: '#26303d',
    colorMutedForeground: '#6d7580',
    colorDanger: '#a45442',
    colorBackground: '#fffdf8',
    colorInput: '#fffdf8',
    colorInputForeground: '#26303d',
    colorNeutral: '#ddd8cd',
    fontFamily: 'Manrope, sans-serif',
    borderRadius: '0.85rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-card border border-card-border rounded-2xl w-[440px] max-w-full overflow-hidden shadow-lg',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'font-display text-foreground text-2xl font-bold tracking-[-.04em]',
    headerSubtitle: 'text-muted-foreground',
    socialButtonsBlockButtonText: 'text-foreground font-semibold',
    formFieldLabel: 'text-foreground font-semibold',
    footerActionLink: 'text-primary font-semibold',
    footerActionText: 'text-muted-foreground',
    dividerText: 'text-muted-foreground',
    identityPreviewEditButton: 'text-primary font-semibold',
    formFieldSuccessText: 'text-primary',
    alertText: 'text-foreground',
    logoBox: 'rounded-lg overflow-hidden',
    logoImage: 'h-8 w-8',
    socialButtonsBlockButton: 'border-border bg-background text-foreground hover:bg-secondary',
    formButtonPrimary: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
    formFieldInput: 'border-input bg-background text-foreground',
    footerAction: 'border-t border-border pt-3',
    dividerLine: 'bg-border',
    alert: 'border-border bg-secondary text-foreground',
    otpCodeFieldInput: 'border-input bg-background text-foreground',
    formFieldRow: 'space-y-1.5',
    main: 'px-1',
  },
};

export function ClerkAuthProvider({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPublishableKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: 'Welcome back',
            subtitle: 'Sign in to continue with your study plan.',
          },
        },
        signUp: {
          start: {
            title: 'Make a little room',
            subtitle: 'Create an account for your student planner.',
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      {children}
    </ClerkProvider>
  );
}

export function SignInPage() {
  const { isLoaded, isSignedIn } = useUser();

  useEffect(() => {
    if (isLoaded && isSignedIn) clearSignUpAttempt();
  }, [isLoaded, isSignedIn]);

  return (
    <AuthFrame mode="sign-in">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
      />
    </AuthFrame>
  );
}

export function SignUpPage() {
  const { isLoaded, isSignedIn } = useUser();

  useEffect(() => {
    if (isLoaded && !isSignedIn) markSignUpStarted();
  }, [isLoaded, isSignedIn]);

  return (
    <AuthFrame mode="sign-up">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
        forceRedirectUrl={`${basePath}/sign-up-complete`}
      />
    </AuthFrame>
  );
}
