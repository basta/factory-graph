import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './tokens.css';
import './canvas/reactflow.css';
import { App } from './App.tsx';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
