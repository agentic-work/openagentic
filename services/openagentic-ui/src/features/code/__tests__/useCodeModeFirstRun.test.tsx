// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCodeModeFirstRun } from '../useCodeModeFirstRun';

vi.mock('../../../utils/api', () => ({
  apiRequest: vi.fn(),
}));

import { apiRequest } from '../../../utils/api';

const mockApiRequest = apiRequest as ReturnType<typeof vi.fn>;

function makeJsonResponse(data: unknown, ok = true) {
  return {
    ok,
    json: async () => data,
  } as Response;
}

describe('useCodeModeFirstRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts with loading=true and firstRunComplete=null', () => {
    mockApiRequest.mockResolvedValue(
      makeJsonResponse({ settings: { codeMode: { firstRunComplete: false } } })
    );
    const { result } = renderHook(() => useCodeModeFirstRun());
    expect(result.current.loading).toBe(true);
    expect(result.current.firstRunComplete).toBeNull();
  });

  it('reads firstRunComplete=false from settings on load', async () => {
    mockApiRequest.mockResolvedValue(
      makeJsonResponse({ settings: { codeMode: { firstRunComplete: false } } })
    );
    const { result } = renderHook(() => useCodeModeFirstRun());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.firstRunComplete).toBe(false);
    expect(mockApiRequest).toHaveBeenCalledWith('/api/user/settings');
  });

  it('reads firstRunComplete=true when set in settings', async () => {
    mockApiRequest.mockResolvedValue(
      makeJsonResponse({ settings: { codeMode: { firstRunComplete: true } } })
    );
    const { result } = renderHook(() => useCodeModeFirstRun());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.firstRunComplete).toBe(true);
  });

  it('defaults firstRunComplete to false when codeMode key is missing', async () => {
    mockApiRequest.mockResolvedValue(
      makeJsonResponse({ settings: {} })
    );
    const { result } = renderHook(() => useCodeModeFirstRun());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.firstRunComplete).toBe(false);
  });

  it('markComplete calls PATCH with firstRunComplete:true', async () => {
    mockApiRequest
      .mockResolvedValueOnce(
        makeJsonResponse({ settings: { codeMode: { firstRunComplete: false } } })
      )
      .mockResolvedValueOnce(
        makeJsonResponse({ settings: { codeMode: { firstRunComplete: true } } })
      );

    const { result } = renderHook(() => useCodeModeFirstRun());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.markComplete();
    });

    expect(mockApiRequest).toHaveBeenCalledWith(
      '/api/user/settings',
      {
        method: 'PATCH',
        body: JSON.stringify({
          settings: { codeMode: { firstRunComplete: true } },
        }),
      }
    );
    expect(result.current.firstRunComplete).toBe(true);
  });

  it('markComplete accepts optional model option without breaking', async () => {
    mockApiRequest
      .mockResolvedValueOnce(
        makeJsonResponse({ settings: {} })
      )
      .mockResolvedValueOnce(
        makeJsonResponse({ settings: { codeMode: { firstRunComplete: true } } })
      );

    const { result } = renderHook(() => useCodeModeFirstRun());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.markComplete({ model: 'claude-opus-4-5' });
    });

    expect(mockApiRequest).toHaveBeenCalledWith(
      '/api/user/settings',
      expect.objectContaining({ method: 'PATCH' })
    );
  });
});
