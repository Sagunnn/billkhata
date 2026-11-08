import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/anek-latin';
import '@fontsource-variable/anek-devanagari';
import '@fontsource-variable/jetbrains-mono';
import './index.css';
import { applyTheme } from './lib/theme.js';
import { loadSettings } from './lib/profile.js';
import { registerServiceWorker } from './lib/offline.js';

applyTheme(loadSettings().theme);
registerServiceWorker();
import App from './App.jsx';
import { StoreProvider } from './store.jsx';
import { ToastProvider } from './components/Toast.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary scope="app">
      <ToastProvider>
        <StoreProvider>
          <App />
        </StoreProvider>
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
);
