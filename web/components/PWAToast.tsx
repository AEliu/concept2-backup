import React from 'react';

interface PWAToastProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onClose?: () => void;
}

export const PWAToast: React.FC<PWAToastProps> = ({
  message,
  actionLabel,
  onAction,
  onClose,
}) => {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 transform transition-all duration-300">
      <div className="bg-black text-white border border-black shadow-lg px-6 py-4 flex items-center gap-4 max-w-md">
        <span className="font-mono text-xs uppercase tracking-wide">{message}</span>

        {actionLabel && onAction && (
          <button
            onClick={onAction}
            className="bg-white text-black px-3 py-1 font-mono text-[10px] uppercase tracking-wider hover:bg-gray-200 transition-colors"
          >
            {actionLabel}
          </button>
        )}

        {onClose && (
          <button
            onClick={onClose}
            className="ml-2 text-gray-400 hover:text-white transition-colors"
            aria-label="Close"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};

export default PWAToast;
