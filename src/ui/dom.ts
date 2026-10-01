/** Small DOM helpers. Nothing clever; just less noise at the call sites. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return node;
}

export function frag(...children: Array<Node | string>): DocumentFragment {
  const f = document.createDocumentFragment();
  for (const c of children) f.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return f;
}

export function clear(node: Element): void {
  node.replaceChildren();
}

/** A scrollable region needs a tabindex, a role and a name (§4.2). */
export function scroller(label: string, inner: Node): HTMLElement {
  return el('div', { class: 'table-scroll', tabindex: '0', role: 'region', 'aria-label': label }, inner);
}

/** Hex dump of the first `max` bytes, 16 to a line with an offset column. */
export function hexDump(bytes: Uint8Array, max = 256): string {
  const n = Math.min(bytes.length, max);
  const lines: string[] = [];
  for (let o = 0; o < n; o += 16) {
    const row = Array.from(bytes.subarray(o, Math.min(o + 16, n)), (b) =>
      b.toString(16).padStart(2, '0')
    ).join(' ');
    lines.push(`${o.toString(16).padStart(6, '0')}  ${row}`);
  }
  if (bytes.length > n) lines.push(`… ${bytes.length - n} more bytes`);
  return lines.join('\n');
}

/** A binary sample run rendered as bits, for a 1-bit stream. */
export function bitStrip(samples: Uint8Array, max = 128): string {
  const n = Math.min(samples.length, max);
  let out = '';
  for (let i = 0; i < n; i++) out += samples[i] ? '1' : '0';
  return out;
}

/** 1234567 -> "1,234,567". The page never prints a bare unformatted count. */
export function count(n: number): string {
  return n.toLocaleString('en-US');
}
