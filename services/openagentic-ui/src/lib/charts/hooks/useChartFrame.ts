import { useEffect, RefObject } from 'react';
import { select, Selection } from 'd3-selection';
import { zoom, zoomIdentity, ZoomBehavior } from 'd3-zoom';

export interface UseChartFrameOptions {
  /** Title used as the default filename when exporting PNG. */
  title?: string;
  /** Disable the whole frame (no zoom/pan/menu). Useful for tiny inline charts. */
  disabled?: boolean;
  /** Min zoom scale. Default 0.3. */
  scaleMin?: number;
  /** Max zoom scale. Default 8. */
  scaleMax?: number;
  /**
   * Wheel-zoom behavior:
   *   'modifier' (default): only zooms when Ctrl/Cmd is held; regular wheel
   *     scrolls the parent page. This is the dashboard-friendly mode — the
   *     mouse doesn't get trapped inside the chart when the user is just
   *     scrolling.
   *   'always': legacy behavior — every wheel event zooms. Use this in
   *     fullscreen / modal views where the user expects map-like zoom.
   *   'off': never zoom on wheel; pan via drag only.
   */
  wheelZoom?: 'modifier' | 'always' | 'off';
  /**
   * When provided, the chart becomes "expandable":
   *   - double-click anywhere on the SVG opens the expand modal (overrides
   *     d3-zoom's reset-on-dblclick)
   *   - an ↗ button is rendered in the top-right corner as a visible cue
   * The caller wires onExpand to its own modal state.
   */
  onExpand?: () => void;
}

/**
 * Wires zoom/pan + right-click context menu onto an SVG. Drop-in equivalent
 * of `_chartframe.js` from the mocks, but with React lifecycle.
 *
 * Usage:
 *   const svg = useRef<SVGSVGElement>(null);
 *   const content = useRef<SVGGElement>(null);
 *   useChartFrame(svg, content, { title: 'sankey-provider-model' });
 *   return <svg ref={svg}><g ref={content}>...</g></svg>;
 *
 * The `content` group is the one that gets the zoom transform applied; the
 * <svg> is what receives the mouse/wheel events. Right-click on the SVG
 * opens a context menu (Reset / Fit / Copy SVG / Export PNG / Fullscreen).
 */
export function useChartFrame(
  svgRef: RefObject<SVGSVGElement>,
  contentRef: RefObject<SVGGElement>,
  options: UseChartFrameOptions = {},
): void {
  const { title = 'chart', disabled = false, scaleMin = 0.3, scaleMax = 8, wheelZoom = 'modifier', onExpand } = options;

  useEffect(() => {
    if (disabled) return;
    const svgEl = svgRef.current;
    const contentEl = contentRef.current;
    if (!svgEl || !contentEl) return;

    const svgSel = select(svgEl);
    const contentSel = select(contentEl);

    const z: ZoomBehavior<SVGSVGElement, unknown> = zoom<SVGSVGElement, unknown>()
      .scaleExtent([scaleMin, scaleMax])
      .filter((event: any) => {
        if (event.type === 'mousedown' && event.button === 2) return false;
        if (event.type === 'contextmenu') return false;
        // Wheel: only zoom when modifier matches policy. Otherwise let the
        // event bubble so the parent page can scroll past the chart.
        if (event.type === 'wheel') {
          if (wheelZoom === 'off') return false;
          if (wheelZoom === 'modifier') return event.ctrlKey || event.metaKey;
          return true; // 'always'
        }
        return !event.ctrlKey && (event.button == null || event.button === 0);
      })
      .on('zoom', (event: any) => {
        contentSel.attr('transform', event.transform.toString());
      });

    svgSel.call(z as any);
    // If onExpand is provided, dblclick OPENS the modal (overriding the
    // d3-zoom reset-on-dblclick that would otherwise fire). Without onExpand,
    // dblclick resets the zoom (the legacy behavior).
    if (onExpand) {
      svgSel.on('dblclick.zoom', null); // unbind d3-zoom's default
      svgSel.on('dblclick.expand', () => { onExpand(); });
    } else {
      svgSel.on('dblclick.zoom', () => {
        svgSel.transition().duration(280).call(z.transform as any, zoomIdentity);
      });
    }

    const menu = buildContextMenu({
      onReset: () => svgSel.transition().duration(280).call(z.transform as any, zoomIdentity),
      onFit: () => svgSel.transition().duration(280).call(z.transform as any, zoomIdentity),
      onCopySvg: () => copySvg(svgEl),
      onExportPng: () => exportPng(svgEl, title),
      onFullscreen: () => toggleFullscreen(svgEl.closest('[data-aw-chart-frame]') as HTMLElement | null ?? svgEl),
    });

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      menu.style.display = 'block';
      menu.style.left = e.clientX + 'px';
      menu.style.top = e.clientY + 'px';
    };
    const onDocClick = () => { menu.style.display = 'none'; };
    const onKeydown = (e: KeyboardEvent) => { if (e.key === 'Escape') menu.style.display = 'none'; };

    svgEl.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKeydown);

    return () => {
      svgEl.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKeydown);
      menu.remove();
      svgSel.on('.zoom', null);
    };
  }, [svgRef, contentRef, title, disabled, scaleMin, scaleMax]);
}

interface MenuActions {
  onReset: () => void;
  onFit: () => void;
  onCopySvg: () => void;
  onExportPng: () => void;
  onFullscreen: () => void;
}

function buildContextMenu(actions: MenuActions): HTMLElement {
  const menu = document.createElement('div');
  menu.setAttribute('data-aw-chart-menu', '');
  Object.assign(menu.style, {
    position: 'fixed', zIndex: '9999', minWidth: '180px',
    background: 'var(--color-surface)', border: 'var(--border-w, 2px) solid var(--color-rule)',
    borderRadius: 'var(--radius-sm, 4px)', padding: '4px 0',
    fontFamily: 'var(--font-body)', fontSize: '12px',
    color: 'var(--color-fg-muted)',
    boxShadow: 'var(--shadow-sm)', display: 'none', userSelect: 'none',
  });
  const items: Array<{ label: string; icon: string; fn: () => void } | { sep: true }> = [
    { label: 'Reset view', icon: '↺', fn: actions.onReset },
    { label: 'Fit to viewport', icon: '⤢', fn: actions.onFit },
    { sep: true },
    { label: 'Copy SVG', icon: '⌘', fn: actions.onCopySvg },
    { label: 'Export PNG', icon: '⇩', fn: actions.onExportPng },
    { sep: true },
    { label: 'Fullscreen', icon: '⛶', fn: actions.onFullscreen },
  ];
  for (const it of items) {
    if ('sep' in it) {
      const sep = document.createElement('div');
      Object.assign(sep.style, { height: '1px', background: 'var(--color-rule)', margin: '4px 0' });
      menu.appendChild(sep);
      continue;
    }
    const row = document.createElement('div');
    row.setAttribute('data-aw-menu-item', '');
    Object.assign(row.style, {
      padding: '6px 14px', cursor: 'pointer',
      display: 'flex', justifyContent: 'space-between', gap: '14px', alignItems: 'center',
    });
    row.innerHTML = `<span>${it.label}</span><span style="color:var(--color-fg-subtle);font-family:var(--font-mono)">${it.icon}</span>`;
    row.onmouseenter = () => row.style.background = 'var(--color-surface-2)';
    row.onmouseleave = () => row.style.background = 'transparent';
    row.onclick = () => { it.fn(); menu.style.display = 'none'; };
    menu.appendChild(row);
  }
  document.body.appendChild(menu);
  return menu;
}

function copySvg(svgEl: SVGSVGElement) {
  const xml = new XMLSerializer().serializeToString(svgEl);
  navigator.clipboard?.writeText(xml).catch(() => { /* swallow */ });
}

function exportPng(svgEl: SVGSVGElement, name: string) {
  const rect = svgEl.getBoundingClientRect();
  const xml = new XMLSerializer().serializeToString(svgEl);
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = rect.width * 2; canvas.height = rect.height * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle =
      getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim() ||
      getComputedStyle(document.documentElement).getPropertyValue('--bg-0').trim() ||
      '#18130C'; // theme-allow: terminal-bg PNG-export fallback (canvas needs a resolved color)
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0, rect.width, rect.height);
    canvas.toBlob((b) => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = name + '.png';
      a.click();
      URL.revokeObjectURL(a.href);
    });
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

function toggleFullscreen(el: HTMLElement | SVGSVGElement | null) {
  if (!el) return;
  if (!document.fullscreenElement) el.requestFullscreen?.();
  else document.exitFullscreen?.();
}
