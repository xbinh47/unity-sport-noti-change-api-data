// Runs in a Web Worker — timers here are NOT throttled on hidden tabs.
// Manages multiple match timers keyed by eventId.
const timers = {};

self.onmessage = (e) => {
  const { cmd, eventId, intervalMs } = e.data;
  if (cmd === 'start') {
    clearInterval(timers[eventId]);
    self.postMessage({ type: 'tick', eventId }); // immediate first tick
    timers[eventId] = setInterval(
      () => self.postMessage({ type: 'tick', eventId }),
      intervalMs
    );
  } else if (cmd === 'stop') {
    clearInterval(timers[eventId]);
    delete timers[eventId];
  }
};
