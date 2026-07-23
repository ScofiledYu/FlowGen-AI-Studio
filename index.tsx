import './silenceReactDevtoolsAd';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import 'reactflow/dist/style.css'; // Import React Flow styles locally
import '@reactflow/node-resizer/dist/style.css'; // 背景框 NodeResizeControl 角点定位（reactflow/style.css 不含）
import './index.css'; // Import Tailwind styles locally

// Suppress ResizeObserver loop errors
const resizeObserverLoopRegex = /ResizeObserver loop/i;
const originalError = console.error;
console.error = (...args) => {
  const msg = args[0];
  if (typeof msg === 'string' && resizeObserverLoopRegex.test(msg)) {
    return;
  }
  originalError.call(console, ...args);
};

window.addEventListener('error', (e) => {
  const msg = e.message || e.toString();
  if (typeof msg === 'string' && resizeObserverLoopRegex.test(msg)) {
    e.stopImmediatePropagation();
    e.preventDefault(); 
  }
});

window.onerror = (message) => {
  const msg = message.toString();
  if (resizeObserverLoopRegex.test(msg)) {
    return true; 
  }
  return false;
};

window.addEventListener('unhandledrejection', (e) => {
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
