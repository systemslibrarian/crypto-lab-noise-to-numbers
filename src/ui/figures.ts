/**
 * A FIGURE IS A VALUE PLUS A UNIT. There is no way to render a bare number
 * through this module, which is the point: the brief requires units stated
 * everywhere, and "min-entropy" said in full rather than "entropy".
 *
 * The two units are genuinely different quantities and the lab shows both:
 *
 *   BITS PER SAMPLE — in the declared symbol width. Maximum = the width.
 *   BITS PER BIT    — the same figure over the width. Maximum = 1.
 *
 * An 8-bit fixture assessed at 7.35 bits per sample and a 1-bit fixture
 * assessed at 0.37 bits per sample are not comparable until both are read per
 * bit (0.919 against 0.373), which is why the per-bit figure exists and why it
 * is labelled DERIVED wherever it appears.
 */
import { el } from './dom.ts';

/** A figure tile. `derived` marks a number this lab computed, not the tool. */
export function figure(
  label: string,
  value: string,
  unit: string,
  opts: { claim?: string; derived?: boolean } = {}
): HTMLElement {
  const attrs: Record<string, string> = { class: 'figure' };
  if (opts.claim) attrs['data-claim'] = opts.claim;
  return el(
    'div',
    attrs,
    el('span', { class: 'figure-label' }, label),
    el('span', { class: 'figure-value' }, value),
    el('span', { class: 'figure-unit' }, opts.derived ? `${unit} (derived)` : unit)
  );
}

/** The absence of a figure, rendered as a figure so it cannot be overlooked. */
export function noFigure(label: string, why: string, claim?: string): HTMLElement {
  const attrs: Record<string, string> = { class: 'figure figure-none' };
  if (claim) attrs['data-claim'] = claim;
  return el(
    'div',
    attrs,
    el('span', { class: 'figure-label' }, label),
    el('span', { class: 'figure-value' }, 'not measured'),
    el('span', { class: 'figure-unit' }, why)
  );
}

/** Min-entropy in bits per sample, naming the width it is out of. */
export function bitsPerSample(v: number, width: number): string {
  return `${v.toFixed(6)} / ${width}`;
}

/** Min-entropy in bits per bit. */
export function bitsPerBit(v: number): string {
  return `${v.toFixed(6)} / 1`;
}

export const UNIT_PER_SAMPLE = 'bits of min-entropy per sample';
export const UNIT_PER_BIT = 'bits of min-entropy per bit';

/** A proportion as a percentage with three decimals. Descriptive statistics. */
export function pct(v: number): string {
  return `${(v * 100).toFixed(3)}%`;
}

/** A correlation coefficient, or the honest word for an undefined one. */
export function corr(r: number): string {
  return Number.isNaN(r) ? 'undefined' : r.toFixed(5);
}
