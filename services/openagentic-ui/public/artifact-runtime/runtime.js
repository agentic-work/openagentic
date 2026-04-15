/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
