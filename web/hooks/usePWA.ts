import { useState, useEffect } from 'react';
import { registerSW } from 'virtual:pwa-register';

interface PWAState {
  needRefresh: boolean;
  offlineReady: boolean;
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
}

export function usePWA(): PWAState {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [updateSW, setUpdateSW] = useState<() => Promise<void>>(() => async () => {});

  useEffect(() => {
    const updateServiceWorker = registerSW({
      onNeedRefresh() {
        setNeedRefresh(true);
      },
      onOfflineReady() {
        setOfflineReady(true);
      },
    });

    setUpdateSW(() => updateServiceWorker);

    return () => {
      // Cleanup if needed
    };
  }, []);

  return {
    needRefresh,
    offlineReady,
    updateServiceWorker: (reloadPage = true) => updateSW(reloadPage),
  };
}

export default usePWA;
