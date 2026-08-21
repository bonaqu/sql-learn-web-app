import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import './lib/api-fetch';
import IntegratedAuthGate from './components/IntegratedAuthGate';
import ChunkErrorBoundary from './components/ChunkErrorBoundary';
import CommercialIdentityPortal from './components/CommercialIdentityPortal';
import PwaStatus from './components/PwaStatus';
import './styles.css';
import './enhancements.css';
import './auth.css';
import './auth-contact-integration.css';
import './commercial-identity.css';
import './commercial-identity-v2.css';
import './learning-path.css';
import './assessment.css';
import './mastery-loop.css';
import './durable-mastery.css';
import './accessibility.css';
import './guided-home.css';
import './mobile-navigation.css';
import './workspace-readiness.css';
import './phase12-ux.css';

const AuthenticatedAcademy = lazy(() => import('./components/AuthenticatedAcademy'));

function AcademyLoadingState() {
  return <main className="auth-loading" role="status" aria-live="polite">Загружаем учебное пространство…</main>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ChunkErrorBoundary>
      <IntegratedAuthGate>
        <Suspense fallback={<AcademyLoadingState />}>
          <AuthenticatedAcademy />
        </Suspense>
      </IntegratedAuthGate>
      <CommercialIdentityPortal />
      <PwaStatus />
    </ChunkErrorBoundary>
  </React.StrictMode>
);
