import React from 'react';
import ReactDOM from 'react-dom/client';
import './lib/api-fetch';
import App from './App';
import AuthGate from './components/AuthGate';
import ChunkErrorBoundary from './components/ChunkErrorBoundary';
import CurriculumSyncAgent from './components/CurriculumSyncAgent';
import DeferredFeaturePortals from './components/DeferredFeaturePortals';
import PwaStatus from './components/PwaStatus';
import './styles.css';
import './enhancements.css';
import './auth.css';
import './learning-path.css';
import './assessment.css';
import './accessibility.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ChunkErrorBoundary>
      <AuthGate>
        <App />
        <DeferredFeaturePortals />
        <CurriculumSyncAgent />
      </AuthGate>
      <PwaStatus />
    </ChunkErrorBoundary>
  </React.StrictMode>
);
