import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import { PluginsPicker } from '../PluginsPicker';
import { DaemonRPCContext } from '../../../hooks/useDaemonRPC';

afterEach(() => {
  cleanup();
});

interface AvailablePlugin {
  name: string;
  marketplace: string;
  description?: string;
  author?: string;
  license?: string;
  installed: boolean;
  enabled?: boolean;
  homepage?: string;
}
interface InstalledPlugin {
  name: string;
  version?: string;
  marketplace?: string;
  enabled?: boolean;
}
interface Marketplace {
  name: string;
  source: string;
  type: string;
  pluginCount: number;
  lastUpdated?: string;
}
interface PluginError {
  name: string;
  marketplace?: string;
  error: string;
  timestamp?: string;
}

function withContext(
  call: (method: string, args?: Record<string, unknown>) => Promise<unknown>,
) {
  return ({ children }: { children: React.ReactNode }) => (
    <DaemonRPCContext.Provider
      value={{
        call: call as <T = unknown>(
          m: string,
          a?: Record<string, unknown>,
        ) => Promise<T>,
        onResponse: () => {},
      }}
    >
      {children}
    </DaemonRPCContext.Provider>
  );
}

/**
 * Build a daemon `call` mock that routes per-method to the supplied
 * fixture map. Anything not in the map throws — surfaces as a daemon
 * error in the picker, useful for guarding against accidental RPCs.
 */
function makeCall(
  fixtures: Partial<{
    list_available_plugins: AvailablePlugin[] | (() => AvailablePlugin[]);
    list_plugins: InstalledPlugin[] | (() => InstalledPlugin[]);
    list_marketplaces: Marketplace[] | (() => Marketplace[]);
    list_plugin_errors: PluginError[] | (() => PluginError[]);
    install_plugin: (args?: Record<string, unknown>) => unknown;
    uninstall_plugin: (args?: Record<string, unknown>) => unknown;
    toggle_plugin: (args?: Record<string, unknown>) => unknown;
    add_marketplace: (args?: Record<string, unknown>) => unknown;
    remove_marketplace: (args?: Record<string, unknown>) => unknown;
  }>,
) {
  return vi.fn(async (method: string, args?: Record<string, unknown>) => {
    if (method === 'list_available_plugins') {
      const v = fixtures.list_available_plugins;
      const plugins = typeof v === 'function' ? v() : (v ?? []);
      return { plugins };
    }
    if (method === 'list_plugins') {
      const v = fixtures.list_plugins;
      const plugins = typeof v === 'function' ? v() : (v ?? []);
      return { plugins };
    }
    if (method === 'list_marketplaces') {
      const v = fixtures.list_marketplaces;
      const marketplaces = typeof v === 'function' ? v() : (v ?? []);
      return { marketplaces };
    }
    if (method === 'list_plugin_errors') {
      const v = fixtures.list_plugin_errors;
      const errors = typeof v === 'function' ? v() : (v ?? []);
      return { errors };
    }
    if (method === 'install_plugin' && fixtures.install_plugin) {
      return fixtures.install_plugin(args);
    }
    if (method === 'uninstall_plugin' && fixtures.uninstall_plugin) {
      return fixtures.uninstall_plugin(args);
    }
    if (method === 'toggle_plugin' && fixtures.toggle_plugin) {
      return fixtures.toggle_plugin(args);
    }
    if (method === 'add_marketplace' && fixtures.add_marketplace) {
      return fixtures.add_marketplace(args);
    }
    if (method === 'remove_marketplace' && fixtures.remove_marketplace) {
      return fixtures.remove_marketplace(args);
    }
    throw new Error(`unexpected method ${method}`);
  });
}

// ────────────────────────────────────────────────────────────────────
// Render gating
// ────────────────────────────────────────────────────────────────────

describe('PluginsPicker — render gating', () => {
  it('renders nothing when open=false', () => {
    const call = vi.fn();
    const Wrapper = withContext(call);
    const { container } = render(
      <Wrapper>
        <PluginsPicker open={false} onClose={() => {}} />
      </Wrapper>,
    );
    expect(container.querySelector('[data-testid="plugins-picker"]')).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  it('renders the picker overlay with the tab bar when open=true', async () => {
    const call = makeCall({});
    const Wrapper = withContext(call as never);
    const { getByTestId, findByTestId } = render(
      <Wrapper>
        <PluginsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    expect(getByTestId('plugins-picker')).toBeTruthy();
    // Tab bar surfaces all four tabs.
    expect(await findByTestId('plugin-tab-discover')).toBeTruthy();
    expect(getByTestId('plugin-tab-installed')).toBeTruthy();
    expect(getByTestId('plugin-tab-marketplaces')).toBeTruthy();
    expect(getByTestId('plugin-tab-errors')).toBeTruthy();
  });
});

// ────────────────────────────────────────────────────────────────────
// Discover tab
// ────────────────────────────────────────────────────────────────────

describe('PluginsPicker — Discover tab', () => {
  it('calls list_available_plugins on mount and renders rows', async () => {
    const available: AvailablePlugin[] = [
      {
        name: 'adspirer-ads-agent',
        marketplace: 'openagentic-plugins-official',
        description: 'Cross-platform ad management for Google Ads…',
        installed: false,
      },
      {
        name: 'ai-plugins',
        marketplace: 'openagentic-plugins-official',
        description: 'Set up endorctl and use Endor Labs to scan…',
        installed: false,
      },
    ];
    const call = makeCall({ list_available_plugins: available });
    const Wrapper = withContext(call as never);
    const { findByText } = render(
      <Wrapper>
        <PluginsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    await findByText('adspirer-ads-agent');
    expect(await findByText('ai-plugins')).toBeTruthy();
    // RPC was invoked with no marketplace filter.
    await waitFor(() => {
      expect(call).toHaveBeenCalledWith(
        'list_available_plugins',
        expect.anything(),
      );
    });
  });

  it('shows X/Y count in the header (filtered/total)', async () => {
    const available: AvailablePlugin[] = Array.from({ length: 5 }, (_, i) => ({
      name: `plugin-${i}`,
      marketplace: 'mp',
      installed: false,
    }));
    const call = makeCall({ list_available_plugins: available });
    const Wrapper = withContext(call as never);
    const { findByText } = render(
      <Wrapper>
        <PluginsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    // No search active → filtered count == total → 5/5.
    await findByText(/5\s*\/\s*5/);
  });

  it('shows author / license / marketplace meta with fallbacks for missing fields', async () => {
    const available: AvailablePlugin[] = [
      {
        name: 'adspirer-ads-agent',
        marketplace: 'openagentic-plugins-official',
        installed: false,
      },
    ];
    const call = makeCall({ list_available_plugins: available });
    const Wrapper = withContext(call as never);
    const { findByText } = render(
      <Wrapper>
        <PluginsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    await findByText('adspirer-ads-agent');
    expect(await findByText(/unknown author/i)).toBeTruthy();
    expect(await findByText(/unknown license/i)).toBeTruthy();
  });

  it('Space on a Discover row calls install_plugin when not installed and refreshes the list', async () => {
    let installed = false;
    const installCalls: Array<Record<string, unknown> | undefined> = [];
    const call = makeCall({
      list_available_plugins: () => [
        {
          name: 'adspirer-ads-agent',
          marketplace: 'mp',
          installed,
        },
      ],
      install_plugin: (args) => {
        installCalls.push(args);
        installed = true;
        return { ok: true, name: args?.spec ?? args?.name };
      },
    });
    const Wrapper = withContext(call as never);
    const { findByText } = render(
      <Wrapper>
        <PluginsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    await findByText('adspirer-ads-agent');

    act(() => {
      fireEvent.keyDown(window, { key: ' ' });
    });

    await waitFor(() => {
      expect(installCalls.length).toBe(1);
    });
    // After install, the picker re-fetches list_available_plugins.
    await waitFor(() => {
      const calls = (call as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c) => c[0] === 'list_available_plugins',
      );
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('Space on a Discover row calls uninstall_plugin when already installed', async () => {
    const uninstallCalls: Array<Record<string, unknown> | undefined> = [];
    const call = makeCall({
      list_available_plugins: () => [
        {
          name: 'already-here',
          marketplace: 'mp',
          installed: true,
          enabled: true,
        },
      ],
      uninstall_plugin: (args) => {
        uninstallCalls.push(args);
        return { ok: true };
      },
    });
    const Wrapper = withContext(call as never);
    const { findByText } = render(
      <Wrapper>
        <PluginsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    await findByText('already-here');

    act(() => {
      fireEvent.keyDown(window, { key: ' ' });
    });

    await waitFor(() => {
      expect(uninstallCalls.length).toBe(1);
      expect(uninstallCalls[0]).toMatchObject({ name: 'already-here' });
    });
  });
});

// ────────────────────────────────────────────────────────────────────
// Search
// ────────────────────────────────────────────────────────────────────

describe('PluginsPicker — Discover search', () => {
  it('filters the visible Discover list by the search term (case-insensitive on name + description)', async () => {
    const available: AvailablePlugin[] = [
      {
        name: 'foo-plugin',
        marketplace: 'mp',
        description: 'first',
        installed: false,
      },
      {
        name: 'bar-plugin',
        marketplace: 'mp',
        description: 'second',
        installed: false,
      },
      {
        name: 'baz-plugin',
        marketplace: 'mp',
        description: 'third about FOO',
        installed: false,
      },
    ];
    const call = makeCall({ list_available_plugins: available });
    const Wrapper = withContext(call as never);
    const { findByText, queryByText, findByPlaceholderText } = render(
      <Wrapper>
        <PluginsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );

    await findByText('foo-plugin');
    const search = (await findByPlaceholderText(/search/i)) as HTMLInputElement;
    act(() => {
      fireEvent.change(search, { target: { value: 'foo' } });
    });

    await waitFor(() => {
      expect(queryByText('bar-plugin')).toBeNull();
    });
    expect(await findByText('foo-plugin')).toBeTruthy();
    // "baz-plugin" matches because its description contains FOO.
    expect(await findByText('baz-plugin')).toBeTruthy();
    // Header shows 2/3.
    expect(await findByText(/2\s*\/\s*3/)).toBeTruthy();
  });
});

// ────────────────────────────────────────────────────────────────────
// Tab switching
// ────────────────────────────────────────────────────────────────────

describe('PluginsPicker — tab switching', () => {
  it('clicking a tab switches the active tab and triggers its data fetch', async () => {
    const call = makeCall({
      list_available_plugins: [
        { name: 'avail', marketplace: 'mp', installed: false },
      ],
      list_plugins: [{ name: 'inst', enabled: true }],
    });
    const Wrapper = withContext(call as never);
    const { findByText, getByTestId } = render(
      <Wrapper>
        <PluginsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    await findByText('avail');

    act(() => {
      fireEvent.click(getByTestId('plugin-tab-installed'));
    });
    await findByText('inst');

    await waitFor(() => {
      expect(
        (call as ReturnType<typeof vi.fn>).mock.calls.some(
          (c) => c[0] === 'list_plugins',
        ),
      ).toBe(true);
    });
  });

  it('Tab key cycles forward through the tabs (Discover → Installed → Marketplaces → Errors → Discover)', async () => {
    const call = makeCall({
      list_available_plugins: [{ name: 'a', marketplace: 'mp', installed: false }],
      list_plugins: [{ name: 'b' }],
      list_marketplaces: [
        { name: 'mp', source: 'gh:org/repo', type: 'git', pluginCount: 1 },
      ],
      list_plugin_errors: [{ name: 'broken', error: 'boom' }],
    });
    const Wrapper = withContext(call as never);
    const { findByText, getByTestId } = render(
      <Wrapper>
        <PluginsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    await findByText('a');
    expect(getByTestId('plugin-tab-discover').getAttribute('data-active')).toBe(
      'true',
    );

    act(() => {
      fireEvent.keyDown(window, { key: 'Tab' });
    });
    await waitFor(() => {
      expect(getByTestId('plugin-tab-installed').getAttribute('data-active')).toBe(
        'true',
      );
    });

    act(() => {
      fireEvent.keyDown(window, { key: 'Tab' });
    });
    await waitFor(() => {
      expect(
        getByTestId('plugin-tab-marketplaces').getAttribute('data-active'),
      ).toBe('true');
    });

    act(() => {
      fireEvent.keyDown(window, { key: 'Tab' });
    });
    await waitFor(() => {
      expect(getByTestId('plugin-tab-errors').getAttribute('data-active')).toBe(
        'true',
      );
    });

    act(() => {
      fireEvent.keyDown(window, { key: 'Tab' });
    });
    await waitFor(() => {
      expect(getByTestId('plugin-tab-discover').getAttribute('data-active')).toBe(
        'true',
      );
    });
  });

  it('Shift-Tab cycles backward', async () => {
    const call = makeCall({
      list_available_plugins: [{ name: 'a', marketplace: 'mp', installed: false }],
      list_plugin_errors: [{ name: 'broken', error: 'boom' }],
    });
    const Wrapper = withContext(call as never);
    const { findByText, getByTestId } = render(
      <Wrapper>
        <PluginsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );
    await findByText('a');

    act(() => {
      fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    });
    await waitFor(() => {
      expect(getByTestId('plugin-tab-errors').getAttribute('data-active')).toBe(
        'true',
      );
    });
  });
});

// ────────────────────────────────────────────────────────────────────
// Installed tab
// ────────────────────────────────────────────────────────────────────

describe('PluginsPicker — Installed tab', () => {
  it('renders installed plugins with name and meta', async () => {
    const call = makeCall({
      list_plugins: [
        { name: 'inst-1', version: '1.0.0', enabled: true, marketplace: 'mp' },
        { name: 'inst-2', version: '2.0.0', enabled: false, marketplace: 'mp' },
      ],
    });
    const Wrapper = withContext(call as never);
    const { getByTestId, findByText } = render(
      <Wrapper>
        <PluginsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );

    act(() => {
      fireEvent.click(getByTestId('plugin-tab-installed'));
    });

    expect(await findByText('inst-1')).toBeTruthy();
    expect(await findByText('inst-2')).toBeTruthy();
  });

  it('Space on an Installed row calls toggle_plugin', async () => {
    const toggleCalls: Array<Record<string, unknown> | undefined> = [];
    const call = makeCall({
      list_plugins: [{ name: 'inst', enabled: true }],
      toggle_plugin: (args) => {
        toggleCalls.push(args);
        return { ok: true, enabled: false };
      },
    });
    const Wrapper = withContext(call as never);
    const { findByText, getByTestId } = render(
      <Wrapper>
        <PluginsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );

    act(() => {
      fireEvent.click(getByTestId('plugin-tab-installed'));
    });
    await findByText('inst');

    act(() => {
      fireEvent.keyDown(window, { key: ' ' });
    });

    await waitFor(() => {
      expect(toggleCalls).toEqual([{ name: 'inst' }]);
    });
  });

  it('`u` on an Installed row calls uninstall_plugin', async () => {
    const uninstallCalls: Array<Record<string, unknown> | undefined> = [];
    const call = makeCall({
      list_plugins: [{ name: 'inst', enabled: true }],
      uninstall_plugin: (args) => {
        uninstallCalls.push(args);
        return { ok: true };
      },
    });
    const Wrapper = withContext(call as never);
    const { findByText, getByTestId } = render(
      <Wrapper>
        <PluginsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );

    act(() => {
      fireEvent.click(getByTestId('plugin-tab-installed'));
    });
    await findByText('inst');

    act(() => {
      fireEvent.keyDown(window, { key: 'u' });
    });

    await waitFor(() => {
      expect(uninstallCalls).toEqual([{ name: 'inst' }]);
    });
  });
});

// ────────────────────────────────────────────────────────────────────
// Marketplaces tab
// ────────────────────────────────────────────────────────────────────

describe('PluginsPicker — Marketplaces tab', () => {
  it('renders marketplaces with name, source, type, plugin count', async () => {
    const call = makeCall({
      list_marketplaces: [
        {
          name: 'openagentic-plugins-official',
          source: 'github.com/openagentic/plugins',
          type: 'git',
          pluginCount: 116,
        },
      ],
    });
    const Wrapper = withContext(call as never);
    const { findByText, getByTestId } = render(
      <Wrapper>
        <PluginsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );

    act(() => {
      fireEvent.click(getByTestId('plugin-tab-marketplaces'));
    });

    expect(await findByText('openagentic-plugins-official')).toBeTruthy();
    expect(await findByText(/116/)).toBeTruthy();
  });

  it('`a` on Marketplaces tab opens the add-form; submitting calls add_marketplace and refreshes', async () => {
    const addCalls: Array<Record<string, unknown> | undefined> = [];
    let count = 0;
    const call = makeCall({
      list_marketplaces: () => {
        count += 1;
        if (count === 1) return [];
        return [
          {
            name: 'mp',
            source: 'gh:org/repo',
            type: 'git',
            pluginCount: 0,
          },
        ];
      },
      add_marketplace: (args) => {
        addCalls.push(args);
        return { ok: true, name: 'mp' };
      },
    });
    const Wrapper = withContext(call as never);
    const { findByText, getByTestId, findByPlaceholderText, findByRole } = render(
      <Wrapper>
        <PluginsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );

    act(() => {
      fireEvent.click(getByTestId('plugin-tab-marketplaces'));
    });
    // Wait for the marketplaces tab to settle (initial empty list).
    await waitFor(() => {
      expect(
        (call as ReturnType<typeof vi.fn>).mock.calls.some(
          (c) => c[0] === 'list_marketplaces',
        ),
      ).toBe(true);
    });

    act(() => {
      fireEvent.keyDown(window, { key: 'a' });
    });

    const sourceInput = (await findByPlaceholderText(
      /marketplace source/i,
    )) as HTMLInputElement;
    act(() => {
      fireEvent.change(sourceInput, { target: { value: 'gh:org/repo' } });
    });
    const submit = await findByRole('button', { name: /add/i });
    act(() => {
      fireEvent.click(submit);
    });

    await waitFor(() => {
      expect(addCalls).toEqual([{ source: 'gh:org/repo' }]);
    });
    // After success the new marketplace appears in the list.
    expect(await findByText('mp')).toBeTruthy();
  });

  it('`d` on Marketplaces row calls remove_marketplace and refreshes', async () => {
    const removeCalls: Array<Record<string, unknown> | undefined> = [];
    const call = makeCall({
      list_marketplaces: [
        { name: 'mp', source: 'gh:org/repo', type: 'git', pluginCount: 0 },
      ],
      remove_marketplace: (args) => {
        removeCalls.push(args);
        return { ok: true };
      },
    });
    const Wrapper = withContext(call as never);
    const { findByText, getByTestId } = render(
      <Wrapper>
        <PluginsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );

    act(() => {
      fireEvent.click(getByTestId('plugin-tab-marketplaces'));
    });
    await findByText('mp');

    act(() => {
      fireEvent.keyDown(window, { key: 'd' });
    });

    await waitFor(() => {
      expect(removeCalls).toEqual([{ name: 'mp' }]);
    });
  });
});

// ────────────────────────────────────────────────────────────────────
// Errors tab
// ────────────────────────────────────────────────────────────────────

describe('PluginsPicker — Errors tab', () => {
  it('renders error rows with name (marketplace) and error message', async () => {
    const call = makeCall({
      list_plugin_errors: [
        {
          name: 'broken-plugin',
          marketplace: 'openagentic-plugins-official',
          error: 'failed to clone',
        },
      ],
    });
    const Wrapper = withContext(call as never);
    const { findByText, getByTestId } = render(
      <Wrapper>
        <PluginsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );

    act(() => {
      fireEvent.click(getByTestId('plugin-tab-errors'));
    });

    expect(await findByText('broken-plugin')).toBeTruthy();
    expect(await findByText(/failed to clone/i)).toBeTruthy();
  });

  it('renders an empty-state message when the daemon returns no errors', async () => {
    const call = makeCall({ list_plugin_errors: [] });
    const Wrapper = withContext(call as never);
    const { getByTestId, findByText } = render(
      <Wrapper>
        <PluginsPicker open={true} onClose={() => {}} />
      </Wrapper>,
    );

    act(() => {
      fireEvent.click(getByTestId('plugin-tab-errors'));
    });
    await findByText(/no plugin errors/i);
  });
});

// ────────────────────────────────────────────────────────────────────
// Esc / close
// ────────────────────────────────────────────────────────────────────

describe('PluginsPicker — Esc handling', () => {
  it('Esc closes the picker', async () => {
    const call = makeCall({});
    const onClose = vi.fn();
    const Wrapper = withContext(call as never);
    render(
      <Wrapper>
        <PluginsPicker open={true} onClose={onClose} />
      </Wrapper>,
    );

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc closes the add-marketplace form (does not close the picker) when it is open', async () => {
    const call = makeCall({ list_marketplaces: [] });
    const onClose = vi.fn();
    const Wrapper = withContext(call as never);
    const { getByTestId, findByPlaceholderText, queryByPlaceholderText } = render(
      <Wrapper>
        <PluginsPicker open={true} onClose={onClose} />
      </Wrapper>,
    );

    act(() => {
      fireEvent.click(getByTestId('plugin-tab-marketplaces'));
    });
    act(() => {
      fireEvent.keyDown(window, { key: 'a' });
    });
    await findByPlaceholderText(/marketplace source/i);

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    // Form is gone, picker is still open.
    await waitFor(() => {
      expect(queryByPlaceholderText(/marketplace source/i)).toBeNull();
    });
    expect(onClose).not.toHaveBeenCalled();

    // A subsequent Esc closes the picker.
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
