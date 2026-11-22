import { createRoot } from 'react-dom/client';
import { Router as WouterRouter } from 'wouter';

import App from './App';
import { ClerkAuthProvider } from '@/components/auth/ClerkAuthProvider';
import { ErrorBoundary } from '@/components/error-boundary';
import { initializeAnalytics } from '@/lib/analytics';

import './index.css';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

initializeAnalytics();

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <WouterRouter base={basePath}>
      <ClerkAuthProvider>
        <App />
      </ClerkAuthProvider>
    </WouterRouter>
  </ErrorBoundary>,
);
