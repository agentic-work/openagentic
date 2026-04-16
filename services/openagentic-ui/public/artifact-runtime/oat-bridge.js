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
