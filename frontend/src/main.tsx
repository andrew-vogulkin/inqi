import React from 'react';
import { createRoot } from 'react-dom/client';
import { injectTokens } from './theme/css-vars';
import { StoreProvider } from './state/store';
import { App } from './App';

injectTokens(); // design tokens → CSS variables + base styles (single source)

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </React.StrictMode>,
);
