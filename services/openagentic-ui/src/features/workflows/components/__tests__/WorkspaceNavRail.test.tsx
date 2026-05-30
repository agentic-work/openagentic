/**
 * WorkspaceNavRail — left icon rail used by the Flows workspace shell.
 *
 * The 9 sections (per docs/mockups/sidebar-endstate.html):
 *   Home · Flows · Agents · Tools · Runs · Insights · Library · Team · Settings
 *
 * Tests:
 *   - renders one button per section, in order, with title + aria-label
 *   - active section is marked aria-current="page"
 *   - clicking a section calls onSelect(sectionId)
 *   - badges (numeric or "alert-dot") render when present in items
 *   - ArrowDown / ArrowUp move focus through the rail
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkspaceNavRail, type WorkspaceNavItem } from '../WorkspaceNavRail';

const ITEMS: WorkspaceNavItem[] = [
  { id: 'home', label: 'Home', iconId: 'i-home' },
  { id: 'flows', label: 'Flows', iconId: 'i-flows' },
  { id: 'agents', label: 'Agents', iconId: 'i-agents', alertDot: true },
  { id: 'tools', label: 'Tools & Data', iconId: 'i-tools' },
  { id: 'runs', label: 'Runs', iconId: 'i-runs', badge: 2 },
  { id: 'insights', label: 'Insights', iconId: 'i-insights' },
  { id: 'library', label: 'Library', iconId: 'i-library' },
  { id: 'team', label: 'Team', iconId: 'i-team' },
  { id: 'settings', label: 'Settings', iconId: 'i-settings' },
];

describe('WorkspaceNavRail', () => {
  it('renders all 9 sections in declared order', () => {
    render(<WorkspaceNavRail items={ITEMS} active="flows" onSelect={() => {}} />);
    const buttons = screen.getAllByRole('button');
    const labels = buttons.map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual([
      'Home', 'Flows', 'Agents', 'Tools & Data', 'Runs',
      'Insights', 'Library', 'Team', 'Settings',
    ]);
  });

  it('marks the active section with aria-current=page', () => {
    render(<WorkspaceNavRail items={ITEMS} active="agents" onSelect={() => {}} />);
    const active = screen.getByRole('button', { name: 'Agents' });
    expect(active.getAttribute('aria-current')).toBe('page');
    const home = screen.getByRole('button', { name: 'Home' });
    expect(home.getAttribute('aria-current')).toBeNull();
  });

  it('calls onSelect with the section id when a button is clicked', () => {
    const onSelect = vi.fn();
    render(<WorkspaceNavRail items={ITEMS} active="home" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tools & Data' }));
    expect(onSelect).toHaveBeenCalledWith('tools');
  });

  it('renders a numeric badge when item.badge is set', () => {
    render(<WorkspaceNavRail items={ITEMS} active="home" onSelect={() => {}} />);
    const runs = screen.getByRole('button', { name: 'Runs' });
    expect(runs.querySelector('[data-testid="nav-badge"]')?.textContent).toBe('2');
  });

  it('renders an alert dot when item.alertDot=true', () => {
    render(<WorkspaceNavRail items={ITEMS} active="home" onSelect={() => {}} />);
    const agents = screen.getByRole('button', { name: 'Agents' });
    expect(agents.querySelector('[data-testid="nav-alert-dot"]')).toBeTruthy();
  });

  it('ArrowDown moves focus to the next button; ArrowUp to previous', () => {
    render(<WorkspaceNavRail items={ITEMS} active="home" onSelect={() => {}} />);
    const home = screen.getByRole('button', { name: 'Home' });
    home.focus();
    fireEvent.keyDown(home, { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Flows');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Agents');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Flows');
  });

  it('ArrowDown at the last button stays on the last button (no wrap)', () => {
    render(<WorkspaceNavRail items={ITEMS} active="home" onSelect={() => {}} />);
    const settings = screen.getByRole('button', { name: 'Settings' });
    settings.focus();
    fireEvent.keyDown(settings, { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Settings');
  });
});
