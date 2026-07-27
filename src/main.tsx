import React from 'react';
import ReactDOM from 'react-dom/client';
import './lib/api-fetch';
import App from './App';
import AuthGate from './components/AuthGate';
import CapstoneLauncher from './components/CapstoneLauncher';
import CapstoneReportSyncAgent from './components/CapstoneReportSyncAgent';
import CheckpointLauncher from './components/CheckpointLauncher';
import ChunkErrorBoundary from './components/ChunkErrorBoundary';
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
import './learning-path.css';
import './assessment.css';
import './mastery-loop.css';
import './accessibility.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ChunkErrorBoundary>
      <AuthGate>
        <App />
        <CheckpointLauncher />
        <OnboardingLauncher />
        <LearningAnalyticsLauncher />
        <CapstoneLauncher />
        <DeferredFeaturePortals />
        <CurriculumSyncAgent />
        <EvidenceSyncAgent />
        <CapstoneReportSyncAgent />
        <OnboardingAgent />
        <LearningAnalyticsAgent />
      </AuthGate>
      <PwaStatus />
    </ChunkErrorBoundary>
  </React.StrictMode>
);
