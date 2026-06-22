import React from 'react';
import ExportButton from './ExportButton';
import { ChatMessage } from '@/types';
import { TopbarCostPill, Crumbs, ToolsPill } from './v2';

interface ChatHeaderProps {
  title: string;
  theme?: 'light' | 'dark';
  messages?: ChatMessage[];
  showExport?: boolean;
  /** Live running cost while a turn is streaming. Pulses the pill dot. */
  runningCost?: number | null;
  /** Topbar breadcrumb trail (mock 01:144). Falls back to [title] if omitted. */
  crumbsTrail?: string[];
  /** Tier-1 internal-tool count for the topbar tools-pill (mock 10:205). */
  toolsInternal?: number;
  /** Tier-2/3 connected MCP-tool count for the topbar tools-pill. */
  toolsConnected?: number;
}

const ChatHeader: React.FC<ChatHeaderProps> = ({
  title,
  theme = 'dark',
  messages = [],
  showExport = true,
  runningCost,
  crumbsTrail,
  toolsInternal = 0,
  toolsConnected = 0,
}) => {
  const trail = crumbsTrail && crumbsTrail.length > 0 ? crumbsTrail : title ? [title] : [];
  return (
    <div
      className="cm-v2"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '14px 24px',
        // Terminal Glass: the top bar is transparent so the frosted glass main
        // panel (and the aurora behind it) reads through; only a soft hairline
        // rule separates it from the stream. Matches the reference top bar.
        borderBottom: '1px solid var(--glass-border)',
        background: 'transparent',
      }}
    >
      <Crumbs trail={trail} />
      <span style={{ flex: 1 }} />
      <ToolsPill internal={toolsInternal} connected={toolsConnected} />
      <TopbarCostPill messages={messages} live={typeof runningCost === 'number' && runningCost > 0} />
      {showExport && messages.length > 0 && (
        <ExportButton messages={messages} sessionTitle={title} theme={theme} />
      )}
    </div>
  );
};

export default ChatHeader;
