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

// oat-bridge.js — postMessage bridge for OAT function calls
// Iframe calls ArtifactRuntime.oat(functionId, args) -> returns Promise
// Parent validates event.source, calls API, sends result back
(function() {
  var pendingCalls = {};
  var callId = 0;

  window.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'oat-result') {
      var pending = pendingCalls[event.data.callId];
      if (pending) {
        delete pendingCalls[event.data.callId];
        if (event.data.success) {
          pending.resolve(event.data.result);
        } else {
          pending.reject(new Error(event.data.error || 'OAT function call failed'));
        }
      }
    }
  });

  window.ArtifactRuntime = window.ArtifactRuntime || {};

  window.ArtifactRuntime.oat = function(functionId, args) {
    return new Promise(function(resolve, reject) {
      var id = ++callId;
      pendingCalls[id] = { resolve: resolve, reject: reject };

      // 30-second timeout per call
      setTimeout(function() {
        if (pendingCalls[id]) {
          delete pendingCalls[id];
          reject(new Error('OAT function call timed out (30s)'));
        }
      }, 30000);

      window.parent.postMessage({
        type: 'oat-execute',
        callId: id,
        functionId: functionId,
        args: args || {}
      }, '*');
    });
  };

  // Font loading helper — injects @font-face rules
  window.ArtifactRuntime.loadFont = function(family, weights) {
    // Fonts are base64-encoded at inline time by the renderer
    // This is a no-op stub — the actual font injection happens in the renderer
    console.log('[ArtifactRuntime] Font request:', family, weights);
  };
})();
