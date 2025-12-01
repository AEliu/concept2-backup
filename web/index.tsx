import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css' 
import { ErrorBoundary } from './components/ErrorBoundary';
// Playfair Display: 标题字体
import '@fontsource/playfair-display/400.css'; // 常规
import '@fontsource/playfair-display/600.css'; // 半粗 (SemiBold)
import '@fontsource/playfair-display/400-italic.css'; // 斜体

// Space Mono: 数据/代码字体
import '@fontsource/space-mono/400.css'; // 常规
import '@fontsource/space-mono/700.css'; // 粗体 (Bold)
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);