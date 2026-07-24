import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './lib/api-fetch';
import App from './App';
import AssessmentAutoResume from './components/AssessmentAutoResume';
import AssessmentCenterPortal from './components/AssessmentCenterPortal';
import AuthGate from './components/AuthGate';
import LearningPathPortal from './components/LearningPathPortal';
import './styles.css';
import './enhancements.css';
import './auth.css';
import './learning-path.css';
import './assessment.css';

registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthGate>
      <App />
      <LearningPathPortal />
      <AssessmentCenterPortal />
      <AssessmentAutoResume />
    </AuthGate>
  </React.StrictMode>
);
