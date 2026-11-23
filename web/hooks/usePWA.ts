import { useState, useEffect } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { ensureOfflineStats } from './statsCache';

interface PWAState {
  needRefresh: boolean;
  offlineReady: boolean;
  dismissOfflineReady: () => void;
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
}

export function usePWA(): PWAState {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [updateSW, setUpdateSW] = useState<PWAState['updateServiceWorker']>(() => async () => {});

  useEffect(() => {
    let active = true;
    const updateServiceWorker = registerSW({
      onNeedRefresh() {
        setNeedRefresh(true);
      },
      onOfflineReady() {
        void ensureOfflineStats().then(ready => {
          if (active && ready) setOfflineReady(true);
        });
      },
    });

    setUpdateSW(() => updateServiceWorker);

    return () => {
      active = false;
    };
  }, []);

  return {
    needRefresh,
    offlineReady,
    dismissOfflineReady: () => setOfflineReady(false),
    updateServiceWorker: (reloadPage = true) => updateSW(reloadPage),
  };
}

export default usePWA;
