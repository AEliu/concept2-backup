import { useEffect, useState } from 'react';
import { loadStats } from './statsCache';

type Resource<T> =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: T };

export function useJson<T>(path: string, notFound?: T): Resource<T> {
  const [state, setState] = useState<{ path: string; resource: Resource<T> }>();

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        let data: T;
        if (path === 'stats.json') {
          data = await loadStats(controller.signal) as T;
        } else {
          const response = await fetch(`${import.meta.env.BASE_URL}${path}`, {
            headers: { Accept: 'application/json' },
            signal: controller.signal,
          });
          const missing = response.status === 404 && notFound !== undefined;
          if (!response.ok && !missing) throw new Error(`Request failed: ${response.status}`);
          data = missing ? notFound : await response.json() as T;
        }
        if (!controller.signal.aborted) setState({ path, resource: { status: 'ready', data } });
      } catch {
        if (!controller.signal.aborted) setState({ path, resource: { status: 'error' } });
      }
    }
    void load();
    return () => controller.abort();
  }, [path, notFound]);

  return state?.path === path ? state.resource : { status: 'loading' };
}
