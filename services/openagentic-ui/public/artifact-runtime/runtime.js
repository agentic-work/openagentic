// runtime.js — Artifact Runtime entry point
// Libraries are inlined at render time (not loaded from files)
// This file provides the ArtifactRuntime namespace and utilities
(function() {
  window.ArtifactRuntime = window.ArtifactRuntime || {};

  // Libraries will be set by the inline script tags
  // e.g., after Chart.js is inlined: window.ArtifactRuntime.Chart = Chart;

  // Utility: detect which libraries are loaded
  window.ArtifactRuntime.getLoadedLibraries = function() {
    var libs = [];
    if (typeof Chart !== 'undefined') libs.push('chart');
    if (typeof d3 !== 'undefined') libs.push('d3');
    if (typeof mermaid !== 'undefined') libs.push('mermaid');
    if (typeof katex !== 'undefined') libs.push('katex');
    if (typeof Plotly !== 'undefined') libs.push('plotly');
    return libs;
  };
})();
