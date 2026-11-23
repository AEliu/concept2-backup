import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePWA } from './usePWA';

const pwa = vi.hoisted(() => ({
  handlers: null as null | { onOfflineReady: () => void; onNeedRefresh: () => void },
  ready: vi.fn(),
}));

vi.mock('virtual:pwa-register', () => ({
  registerSW: (handlers: { onOfflineReady: () => void; onNeedRefresh: () => void }) => {
    pwa.handlers = handlers;
    return vi.fn(async () => {});
  },
}));
vi.mock('./statsCache', () => ({
  ensureOfflineStats: pwa.ready,
}));

describe('usePWA', () => {
  it('shows and dismisses readiness only after valid statistics are cached', async () => {
    pwa.ready.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { result } = renderHook(() => usePWA());

    act(() => pwa.handlers?.onOfflineReady());
    await waitFor(() => expect(pwa.ready).toHaveBeenCalledTimes(1));
    expect(result.current.offlineReady).toBe(false);

    act(() => pwa.handlers?.onOfflineReady());
    await waitFor(() => expect(result.current.offlineReady).toBe(true));
    act(() => result.current.dismissOfflineReady());
    expect(result.current.offlineReady).toBe(false);

    act(() => pwa.handlers?.onNeedRefresh());
    expect(result.current.needRefresh).toBe(true);
  });
});
