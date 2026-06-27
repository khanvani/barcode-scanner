/**
 * Plays a short, snappy confirmation beep using Web Audio API.
 * - 1200Hz frequency — higher pitch = feels faster/more responsive
 * - 120ms duration — short burst, not lingering
 * - Closes AudioContext after use — prevents resource leak on mobile Safari
 *   (which limits concurrent AudioContexts)
 */
export function useBeep() {
  function beep() {
    let ctx;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.connect(gain);
      gain.connect(ctx.destination);

      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(1200, ctx.currentTime);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);

      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.12);

      // Close context after sound finishes to free resources
      oscillator.onended = () => {
        ctx.close().catch(() => {});
      };
    } catch (e) {
      // Audio not available — fail silently
      if (ctx) ctx.close().catch(() => {});
    }
  }

  return beep;
}
