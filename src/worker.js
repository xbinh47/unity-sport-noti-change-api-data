// Timer runs in Web Worker so it is NOT throttled when the tab is in background.
// Browsers throttle setTimeout/setInterval on hidden main-thread tabs (to >=1s/1min),
// but worker timers keep firing, so background polling stays accurate.
let timer = null;

self.onmessage = (e) => {
  const { cmd, intervalMs } = e.data;
  if (cmd === 'start') {
    clearInterval(timer);
    self.postMessage({ type: 'tick' }); // fire immediately
    timer = setInterval(() => self.postMessage({ type: 'tick' }), intervalMs);
  } else if (cmd === 'stop') {
    clearInterval(timer);
    timer = null;
  }
};
