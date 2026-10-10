import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './tokens.css';
import './canvas/reactflow.css';
import { App } from './App.tsx';
import { CHANNEL } from './graph/channel.ts';

// The tab title is often all you can see of which site you are on.
if (CHANNEL === 'staging') document.title = 'Factory Graph (staging)';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
