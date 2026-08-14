import { useCallback } from 'react';

/**
 * Plays a short confirmation beep using Web Audio API.
 * - 1200Hz / 120ms — short burst
 * - Closes AudioContext after use to avoid Safari's concurrent-context limit
 */
export function useBeep() {
  return useCallback(() => {
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

      oscillator.onended = () => {
        ctx.close().catch(() => {});
      };
    } catch {
      if (ctx) ctx.close().catch(() => {});
    }
  }, []);
}
