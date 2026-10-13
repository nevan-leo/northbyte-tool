// One place for money, so a gain never prints with a minus inside it and a loss
// never prints with a plus in front of it.

const M = 1_000_000;

/** −$58.8M · $0.0M. The sign is the number's own. */
export const money = (v: number) =>
  `${v < 0 ? '−' : ''}$${Math.abs(v / M).toFixed(1)}M`;

/**
 * +$42.8M · −$1.2M · no change. For a difference against something, where the
 * direction is the whole point. Anything under $50k is noise, not a movement.
 */
export const signed = (v: number, unit = 'M') => {
  if (!Number.isFinite(v)) return 'no change';
  if (Math.abs(v) < 0.05 * M) return 'no change';
  return `${v > 0 ? '+' : '−'}$${Math.abs(v / M).toFixed(1)}${unit}`;
};

export const count = (v: number) => Math.round(v).toLocaleString('en-US');
export const pct = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`;
export const sign = (v: number) => (v < 0 ? 'neg' : v > 0 ? 'pos' : '');
