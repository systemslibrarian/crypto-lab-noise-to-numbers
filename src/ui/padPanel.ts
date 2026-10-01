/**
 * ACT 6 — ONE-TIME PAD.
 *
 * Deliberately a SHORT act. `crypto-lab-otp-vault` already covers the one-time
 * pad and the two-time-pad attack in full; repeating it here would be a worse
 * version of a lab that exists. What this act does is close THIS lab's arc:
 * the pad is where the entropy budget is finally spent, and it is where a
 * public stream stops being useful and becomes dangerous.
 *
 * Three facts, each shown rather than asserted:
 *   - a PUBLIC pad gives zero secrecy: the reader decrypts without a secret;
 *   - the pad must be at least as long as the message;
 *   - reusing a pad leaks the XOR of the two plaintexts.
 */
import { clear, el } from './dom.ts';
import { neverASecretBadge } from './labels.ts';
import { le64, webcryptoSha256 } from '../entropy/counter-hash.ts';
import { count } from './dom.ts';

const enc = new TextEncoder();

const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

function xor(a: Uint8Array, b: Uint8Array): Uint8Array {
  const n = Math.min(a.length, b.length);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = a[i] ^ b[i];
  return out;
}

/** Printable rendering of bytes that may not be text. */
function printable(b: Uint8Array): string {
  return Array.from(b, (x) => (x >= 0x20 && x < 0x7f ? String.fromCharCode(x) : '·')).join('');
}

export function renderPadPanel(root: HTMLElement): void {
  clear(root);

  root.append(
    el(
      'div',
      { class: 'onramp' },
      el('h2', {}, 'Where the entropy budget gets spent'),
      el(
        'p',
        {},
        'The one-time pad is the only cipher with a proof of perfect secrecy, and the proof comes ' +
          'with three conditions: the pad is ',
        el('strong', {}, 'uniformly random'),
        ', at least as ',
        el('strong', {}, 'long'),
        ' as the message, and used exactly ',
        el('strong', {}, 'once'),
        '. Break any one and the proof says nothing at all.'
      ),
      el(
        'p',
        {},
        'That first condition is everything the previous five acts were about. The pad has to ' +
          'carry one full bit of min-entropy per bit of message — nothing less will do, and ' +
          'no amount of conditioning will manufacture it. It is the strictest entropy requirement ' +
          'in cryptography, and it is why the accounting matters.'
      ),
      el(
        'p',
        { class: 'note' },
        'This act is deliberately brief. For the pad itself, the key-reuse attack and Shannon’s ' +
          'proof, see ',
        el(
          'a',
          { href: 'https://systemslibrarian.github.io/crypto-lab-otp-vault/', target: '_blank', rel: 'noopener' },
          'crypto-lab-otp-vault'
        ),
        ', which is built for it.'
      )
    )
  );

  // ── A public pad gives zero secrecy ─────────────────────────────────────
  const card = el('div', { class: 'card' });
  card.append(
    el('h2', {}, 'A public pad is not a pad'),
    el('div', { class: 'badge-row' }, neverASecretBadge()),
    el(
      'p',
      {},
      'The pad below is generated from this lab’s own published counter-hash construction. ' +
        'It is uniformly distributed, it passes every descriptive statistic in Act 2, and it was ' +
        'assessed at a high min-entropy figure in Act 5. It is also printed in this repository. ' +
        'Encrypt something with it and then decrypt it — without being told any secret.'
    )
  );

  const msgInput = el('textarea', {
    id: 'pad-message',
    rows: '2',
    'aria-label': 'Message to encrypt with the public pad',
  }) as HTMLTextAreaElement;
  msgInput.value = 'meet at the bridge at noon';

  const padLenInput = el('input', {
    id: 'pad-length',
    type: 'number',
    min: '0',
    max: '256',
    value: '32',
    'aria-label': 'Pad length in bytes',
  }) as HTMLInputElement;

  const out = el('div', { id: 'pad-out', role: 'status', 'aria-live': 'polite' });

  const run = (): void => {
    void (async (): Promise<void> => {
      const msg = enc.encode(msgInput.value);
      const want = Number(padLenInput.value);
      const padLen = Number.isFinite(want) && want >= 0 ? Math.floor(want) : 0;

      // The pad: the published construction again, so it is public by design.
      const pad = new Uint8Array(padLen);
      for (let o = 0; o < padLen; o += 32) {
        const block = await webcryptoSha256(le64(o / 32));
        pad.set(block.subarray(0, Math.min(32, padLen - o)), o);
      }

      clear(out);

      if (padLen < msg.length) {
        // The length condition, as a reachable failure state.
        const covered = xor(msg, pad);
        const tail = msg.subarray(padLen);
        out.append(
          el(
            'div',
            { class: 'verdict verdict-bad', 'data-verdict': 'pad-too-short' },
            el('span', { 'aria-hidden': 'true' }, '✕'),
            el(
              'span',
              { class: 'verdict-text' },
              el('strong', {}, 'Pad too short. '),
              `The pad is ${count(padLen)} bytes and the message is ${count(msg.length)}. The ` +
                `last ${count(msg.length - padLen)} bytes have nothing to XOR against, so they ` +
                'would go out in the clear. There is no "mostly encrypted".'
            )
          ),
          el('h4', {}, 'What would actually go on the wire'),
          el(
            'pre',
            { class: 'hex', tabindex: '0', role: 'region', 'aria-label': 'Ciphertext with the uncovered tail' },
            `covered  : ${hex(covered)}\nIN CLEAR : ${printable(tail)}`
          )
        );
        return;
      }

      const ct = xor(msg, pad.subarray(0, msg.length));
      const recovered = xor(ct, pad.subarray(0, msg.length));

      out.append(
        el('h4', {}, 'The pad (public, from the published construction)'),
        el('pre', { class: 'hex', tabindex: '0', role: 'region', 'aria-label': 'The public pad' }, hex(pad)),
        el('h4', {}, 'Ciphertext'),
        el('pre', { class: 'hex', tabindex: '0', role: 'region', 'aria-label': 'Ciphertext' }, hex(ct)),
        el('h4', {}, 'Decrypted, using only what this page already told you'),
        el(
          'pre',
          { class: 'hex', tabindex: '0', role: 'region', 'aria-label': 'Recovered plaintext', 'data-claim': 'pad-recovered' },
          printable(recovered)
        ),
        el(
          'div',
          { class: 'verdict verdict-bad', 'data-verdict': 'public-pad-zero-secrecy' },
          el('span', { 'aria-hidden': 'true' }, '✕'),
          el(
            'span',
            { class: 'verdict-text' },
            el('strong', {}, 'DECRYPTED — AND NO SECRET WAS USED. '),
            'Every XOR above used a pad published in this repository. The arithmetic of the ' +
              'one-time pad is perfect and the secrecy is zero, because secrecy was never a ' +
              'property of the XOR. Statistical quality is not secrecy, and a measured ' +
              'min-entropy figure says nothing about who else has the bytes.'
          )
        )
      );
    })();
  };

  const runBtn = el('button', { class: 'btn btn-primary', type: 'button', id: 'pad-run' }, 'Encrypt, then decrypt');
  runBtn.addEventListener('click', run);

  card.append(
    el(
      'div',
      { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'pad-message' }, 'Message'), msgInput),
      el('div', { class: 'field' }, el('label', { for: 'pad-length' }, 'Pad length (bytes)'), padLenInput),
      runBtn
    ),
    out
  );
  root.append(card);

  // ── Two-time pad ────────────────────────────────────────────────────────
  const reuse = el('div', { class: 'card' });
  const reuseOut = el('div', { id: 'reuse-out', role: 'status', 'aria-live': 'polite' });
  const m1 = el('textarea', { id: 'reuse-m1', rows: '2', 'aria-label': 'First message' }) as HTMLTextAreaElement;
  const m2 = el('textarea', { id: 'reuse-m2', rows: '2', 'aria-label': 'Second message' }) as HTMLTextAreaElement;
  m1.value = 'attack at dawn';
  m2.value = 'retreat at dusk';

  const reuseBtn = el('button', { class: 'btn btn-primary', type: 'button', id: 'reuse-run' }, 'Reuse the pad once');
  reuseBtn.addEventListener('click', () => {
    void (async (): Promise<void> => {
      const a = enc.encode(m1.value);
      const b = enc.encode(m2.value);
      const n = Math.min(a.length, b.length);
      const pad = new Uint8Array(n);
      for (let o = 0; o < n; o += 32) {
        const block = await webcryptoSha256(le64(1000 + o / 32));
        pad.set(block.subarray(0, Math.min(32, n - o)), o);
      }
      const c1 = xor(a.subarray(0, n), pad);
      const c2 = xor(b.subarray(0, n), pad);
      const leak = xor(c1, c2);
      const check = xor(a.subarray(0, n), b.subarray(0, n));

      clear(reuseOut);
      reuseOut.append(
        el('h4', {}, 'The two ciphertexts'),
        el(
          'pre',
          { class: 'hex', tabindex: '0', role: 'region', 'aria-label': 'Two ciphertexts under one pad' },
          `c1 = ${hex(c1)}\nc2 = ${hex(c2)}`
        ),
        el('h4', {}, 'c1 XOR c2, which anyone can compute'),
        el(
          'pre',
          { class: 'hex', tabindex: '0', role: 'region', 'aria-label': 'XOR of the two ciphertexts', 'data-claim': 'reuse-leak' },
          `${hex(leak)}\n\nand m1 XOR m2 is\n${hex(check)}`
        ),
        el(
          'div',
          { class: 'verdict verdict-bad', 'data-verdict': 'two-time-pad-leak' },
          el('span', { 'aria-hidden': 'true' }, '✕'),
          el(
            'span',
            { class: 'verdict-text' },
            el(
              'strong',
              {},
              hex(leak) === hex(check)
                ? 'THE PAD CANCELLED. c1 XOR c2 equals m1 XOR m2 exactly. '
                : 'c1 XOR c2 computed. '
            ),
            'The pad is gone from the result, so what is left is a relationship between the two ' +
              'plaintexts — with no key involved at all. Given a guess at either message, the ' +
              'other falls out. The entropy of the pad was perfectly adequate; using it twice ' +
              'made it irrelevant.'
          )
        )
      );
    })();
  });

  reuse.append(
    el('h2', {}, 'Used twice, the pad cancels itself'),
    el(
      'p',
      {},
      'If c₁ = m₁ ⊕ k and c₂ = m₂ ⊕ k, then c₁ ⊕ c₂ = ' +
        'm₁ ⊕ m₂. The key disappears. This is arithmetic, not a weakness in any ' +
        'particular pad, and it holds however good the entropy behind k was.'
    ),
    el(
      'div',
      { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'reuse-m1' }, 'Message 1'), m1),
      el('div', { class: 'field' }, el('label', { for: 'reuse-m2' }, 'Message 2'), m2),
      reuseBtn
    ),
    reuseOut
  );
  root.append(reuse);
}
