import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './lib/api-fetch';
import App from './App';
import SyncAccountPortal from './components/SyncAccountPortal';
import LearningPathPortal from './components/LearningPathPortal';
import './styles.css';
import './enhancements.css';
import './account.css';
import './learning-path.css';

registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <SyncAccountPortal />
    <LearningPathPortal />
  </React.StrictMode>
);
