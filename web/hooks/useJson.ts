import { useEffect, useState } from 'react';

type Resource<T> =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: T };

export function useJson<T>(path: string): Resource<T> {
  const [state, setState] = useState<{ path: string; resource: Resource<T> }>();

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}${path}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Request failed: ${response.status}`);
        const data = await response.json() as T;
        if (!controller.signal.aborted) setState({ path, resource: { status: 'ready', data } });
      } catch {
        if (!controller.signal.aborted) setState({ path, resource: { status: 'error' } });
      }
    }
    void load();
    return () => controller.abort();
  }, [path]);

  return state?.path === path ? state.resource : { status: 'loading' };
}
