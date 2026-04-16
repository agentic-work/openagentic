import React, { useState, useRef, useEffect } from 'react';
import {
  Zap,
  Trash2,
  DollarSign,
  Cpu,
  ChevronUp,
  Shield,
  Wifi,
  WifiOff,
} from '@/shared/icons';

interface TerminalToolbarProps {
  /** Send text to the PTY stdin */
  onSendInput: (text: string) => void;
  /** Current model name */
  model?: string;
  /** Whether yolo mode is active */
  yoloMode?: boolean;
  /** WebSocket connection state */
  connected?: boolean;
  /** Theme */
  theme?: 'light' | 'dark';
}

const SLASH_COMMANDS = [
  { cmd: '/help', label: 'Help', desc: 'Show all commands' },
  { cmd: '/model', label: 'Model', desc: 'Switch model' },
  { cmd: '/cost', label: 'Cost', desc: 'Show session cost' },
  { cmd: '/compact', label: 'Compact', desc: 'Compress context' },
  { cmd: '/clear', label: 'Clear', desc: 'Clear conversation' },
  { cmd: '/init', label: 'Init', desc: 'Initialize project' },
  { cmd: '/review', label: 'Review', desc: 'Code review' },
  { cmd: '/context', label: 'Context', desc: 'Show context usage' },
];

export const TerminalToolbar: React.FC<TerminalToolbarProps> = ({
  onSendInput,
  model,
  yoloMode = false,
  connected = false,
  theme = 'dark',
}) => {
  const [showCommands, setShowCommands] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowCommands(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const isDark = theme === 'dark';
  const bg = isDark ? 'bg-[#12122a]' : 'bg-gray-100';
  const border = isDark ? 'border-gray-800' : 'border-gray-300';
  const text = isDark ? 'text-gray-400' : 'text-gray-600';
  const hover = isDark ? 'hover:bg-gray-800 hover:text-gray-200' : 'hover:bg-gray-200 hover:text-gray-800';
  const active = isDark ? 'bg-gray-700 text-white' : 'bg-gray-300 text-gray-900';

  return (
    <div className={`flex items-center justify-between px-3 py-1.5 ${bg} ${border} border-t text-xs`}>
      {/* Left: slash commands + actions */}
      <div className="flex items-center gap-1 relative" ref={menuRef}>
        <button
          onClick={() => setShowCommands(!showCommands)}
          className={`flex items-center gap-1 px-2 py-1 rounded ${hover} ${text}`}
          title="Slash commands"
        >
          <ChevronUp className={`w-3 h-3 transition-transform ${showCommands ? 'rotate-180' : ''}`} />
          <span>/</span>
        </button>

        {showCommands && (
          <div className={`absolute bottom-full left-0 mb-1 ${isDark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-300'} border rounded-lg shadow-lg py-1 min-w-[200px] z-50`}>
            {SLASH_COMMANDS.map((cmd) => (
              <button
                key={cmd.cmd}
                onClick={() => {
                  onSendInput(cmd.cmd + '\n');
                  setShowCommands(false);
                }}
                className={`w-full text-left px-3 py-1.5 ${hover} flex items-center justify-between`}
              >
                <span className="font-mono text-xs">{cmd.cmd}</span>
                <span className={`text-xs ${text}`}>{cmd.desc}</span>
              </button>
            ))}
          </div>
        )}

        <button
          onClick={() => onSendInput('/clear\n')}
          className={`p-1 rounded ${hover} ${text}`}
          title="Clear conversation"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => onSendInput('/cost\n')}
          className={`p-1 rounded ${hover} ${text}`}
          title="Show cost"
        >
          <DollarSign className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => onSendInput('/compact\n')}
          className={`p-1 rounded ${hover} ${text}`}
          title="Compact context"
        >
          <Zap className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Center: model info */}
      <div className="flex items-center gap-2">
        {model && (
          <button
            onClick={() => onSendInput('/model\n')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded ${hover} ${text}`}
            title="Switch model"
          >
            <Cpu className="w-3 h-3" />
            <span className="font-mono truncate max-w-[200px]">{model}</span>
          </button>
        )}
      </div>

      {/* Right: status indicators */}
      <div className="flex items-center gap-2">
        {yoloMode ? (
          <span className={`flex items-center gap-1 text-orange-400`} title="Yolo mode — auto-approve all">
            <Shield className="w-3 h-3" />
            <span>yolo</span>
          </span>
        ) : (
          <span className={`flex items-center gap-1 ${text}`} title="Permission prompts enabled">
            <Shield className="w-3 h-3" />
          </span>
        )}

        <span className={`flex items-center gap-1 ${connected ? 'text-green-500' : 'text-red-500'}`}>
          {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
        </span>
      </div>
    </div>
  );
};

export default TerminalToolbar;
