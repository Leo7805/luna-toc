/** Mounts the React options application. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { OptionsApp } from '@/components/options/OptionsApp';
import './options.css';

const root = document.getElementById('root');
if (!root) throw new Error('Options root element not found.');

createRoot(root).render(
  <StrictMode>
    <OptionsApp />
  </StrictMode>
);
