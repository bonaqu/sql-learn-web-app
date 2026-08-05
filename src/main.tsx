import React from 'react';
import ReactDOM from 'react-dom/client';
import './lib/api-fetch';
import App from './App';
import IntegratedAuthGate from './components/IntegratedAuthGate';
import CapstoneLauncher from './components/CapstoneLauncher';
import CapstoneReportSyncAgent from './components/CapstoneReportSyncAgent';
import CheckpointLauncher from './components/CheckpointLauncher';
import ChunkErrorBoundary from './components/ChunkErrorBoundary';
import CommercialIdentityPortal from './components/CommercialIdentityPortal';
import CurriculumSyncAgent from './components/CurriculumSyncAgent';
import DeferredFeaturePortals from './components/DeferredFeaturePortals';
import EvidenceSyncAgent from './components/EvidenceSyncAgent';
import LearningAnalyticsAgent from './components/LearningAnalyticsAgent';
import LearningAnalyticsLauncher from './components/LearningAnalyticsLauncher';
import OnboardingAgent from './components/OnboardingAgent';
import OnboardingLauncher from './components/OnboardingLauncher';
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
import './accessibility.css';
import './guided-home.css';
import './mobile-navigation.css';
import './workspace-readiness.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ChunkErrorBoundary>
      <IntegratedAuthGate>
        <App />
        <CheckpointLauncher />
        <OnboardingLauncher />
        <CapstoneLauncher />
        <LearningAnalyticsLauncher />
        <DeferredFeaturePortals />
        <CurriculumSyncAgent />
        <EvidenceSyncAgent />
        <CapstoneReportSyncAgent />
        <OnboardingAgent />
        <LearningAnalyticsAgent />
      </IntegratedAuthGate>
      <CommercialIdentityPortal />
      <PwaStatus />
    </ChunkErrorBoundary>
  </React.StrictMode>
);
