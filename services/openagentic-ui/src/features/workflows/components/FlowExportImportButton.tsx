/**
 * FlowExportImportButton
 *
 * Toolbar control pair for downloading/uploading the current
 * workflow as raw JSON. Useful for backups, sharing, and moving
 * a flow between environments.
 *
 * Export: serializes whatever `getFlowJson()` returns and triggers
 * a browser download with a filename derived from `flowName`. The
 * button is disabled when `getFlowJson()` returns null (e.g. no
 * flow loaded yet).
 *
 * Import: opens a hidden <input type="file">, reads the picked
 * file, and calls `onImport(text)` with the file contents. If the
 * file's contents don't parse as JSON the callback gets `null` so
 * the parent can surface an error toast.
 */

import React, { useRef } from 'react';
import { Download, Upload } from 'lucide-react';

interface Props {
  /** Used to derive the download filename. */
  flowName: string;
  /** Returns the current flow as a JSON string, or null if nothing
   *  to export yet (e.g. before a flow is loaded). */
  getFlowJson: () => string | null;
  /** Called when the user picks a file. `text` is the raw file
   *  contents — the parent should JSON.parse + apply. `null` means
   *  the file failed to parse as JSON; the parent should show an
   *  error toast. */
  onImport: (text: string | null) => void;
}

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'flow'
  );
}

export const FlowExportImportButton: React.FC<Props> = ({
  flowName,
  getFlowJson,
  onImport,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const flowJson = getFlowJson();
  const exportDisabled = !flowJson;

  const handleExport = () => {
    if (!flowJson) return;
    const blob = new Blob([flowJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slugify(flowName)}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      try {
        JSON.parse(text);
        onImport(text);
      } catch {
        onImport(null);
      }
    };
    reader.onerror = () => onImport(null);
    reader.readAsText(file);
    // Reset so re-picking the same file fires onChange again.
    e.target.value = '';
  };

  return (
    <div style={{ display: 'inline-flex', gap: 4 }}>
      <button
        type="button"
        onClick={handleExport}
        disabled={exportDisabled}
        title="Export flow as JSON"
        aria-label="Export flow as JSON"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          fontSize: 12,
          background: 'transparent',
          color: exportDisabled ? 'var(--color-text-disabled, #555)' : 'var(--color-text-secondary, #8b949e)',
          border: '1px solid var(--color-border, #2a2a2a)',
          borderRadius: 4,
          cursor: exportDisabled ? 'not-allowed' : 'pointer',
        }}
      >
        <Download size={14} aria-hidden="true" />
        <span>Export</span>
      </button>
      <button
        type="button"
        onClick={handleImportClick}
        title="Import flow from JSON"
        aria-label="Import flow from JSON"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          fontSize: 12,
          background: 'transparent',
          color: 'var(--color-text-secondary, #8b949e)',
          border: '1px solid var(--color-border, #2a2a2a)',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        <Upload size={14} aria-hidden="true" />
        <span>Import</span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={handleFileChange}
        style={{ display: 'none' }}
        aria-hidden="true"
        tabIndex={-1}
      />
    </div>
  );
};
