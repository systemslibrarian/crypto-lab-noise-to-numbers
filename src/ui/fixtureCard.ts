/**
 * The fixture's own paperwork: encoding, checksums, generator, and the exact
 * commands that reproduce its recorded figures.
 *
 * This is what makes the lab's numbers checkable rather than merely stated.
 * Everything here is read out of the generated manifest; nothing is composed
 * from prose. The reproduction block is the brief's definition of done —
 * download the file, convert it, run the listed command, get these figures.
 */
import { count, el } from './dom.ts';
import { badgeRow } from './labels.ts';
import type { Fixture } from '../entropy/types.ts';

/** The download link for a fixture, relative so it works under the subpath. */
export function downloadLink(f: Fixture): HTMLAnchorElement {
  return el(
    'a',
    { href: f.download, download: `${f.id}.bin`, 'data-claim': `download-${f.id}` },
    `Download ${f.id}.bin (${count(f.encoding.originalBytes)} bytes)`
  ) as HTMLAnchorElement;
}

/** The encoding block the brief requires in every manifest, rendered. */
export function encodingBlock(f: Fixture): HTMLElement {
  const e = f.encoding;
  return el(
    'dl',
    { class: 'kv' },
    el('dt', {}, 'Samples'),
    el('dd', {}, `${count(e.sampleCount)} at ${e.bitsPerSymbol} bit${e.bitsPerSymbol === 1 ? '' : 's'} per sample`),
    el('dt', {}, 'Shipped as'),
    el(
      'dd',
      {},
      e.shippedForm === 'packed-bits'
        ? `packed bits, eight samples to a byte, ${e.bitOrder}`
        : 'one sample per byte'
    ),
    el('dt', {}, 'Original size'),
    el('dd', {}, `${count(e.originalBytes)} bytes`),
    el('dt', {}, 'Original SHA-256'),
    el('dd', { 'data-claim': `sha-original-${f.id}` }, e.originalSha256),
    el('dt', {}, 'Converted size'),
    el('dd', {}, `${count(e.convertedBytes)} bytes, one sample per byte`),
    el('dt', {}, 'Converted SHA-256'),
    el('dd', { 'data-claim': `sha-converted-${f.id}` }, e.convertedSha256),
    el('dt', {}, 'Conversion'),
    el('dd', {}, e.conversion),
    el('dt', {}, 'Incomplete final sample'),
    el('dd', {}, e.incompleteFinalSample),
    el('dt', {}, 'Generator'),
    el('dd', {}, f.seed === null ? f.generator : `${f.generator}, seed ${f.seed}`),
    el('dt', {}, 'Procedure'),
    el('dd', {}, f.procedure)
  );
}

/** The commands that reproduce this fixture's recorded figures. */
export function reproductionBlock(f: Fixture): HTMLElement {
  const a = f.assessment;
  const box = el('div', {});
  if (a === null) {
    box.append(
      el('p', { class: 'note' }, 'There is no recorded assessment for this file, so there is nothing to reproduce.')
    );
    return box;
  }
  const lines = [
    '# 1. build the pinned assessment tool (see SPIKE.md for the full recipe)',
    `git clone ${a.tool.forkRepo}`,
    `cd SP800-90B_EntropyAssessment && git checkout ${a.tool.forkCommit}`,
    'brew install libomp libdivsufsort jsoncpp openssl@3   # or the apt equivalents',
    'cd cpp && make non_iid',
    '',
    '# 2. convert the shipped fixture to the one-sample-per-byte form the tool reads',
    f.encoding.shippedForm === 'packed-bits'
      ? f.encoding.conversion
      : `# already one sample per byte: cp ${f.id}.bin ${f.id}.samples.bin`,
    `#    the result must hash to ${f.encoding.convertedSha256}`,
    '',
    '# 3. run the assessment',
    a.command,
  ];
  box.append(
    el('p', {}, 'Every figure shown for this file came from this run, on this machine, on these bytes:'),
    el('pre', { class: 'hex', tabindex: '0', role: 'region', 'aria-label': `Reproduction commands for ${f.id}` }, lines.join('\n')),
    el(
      'dl',
      { class: 'kv' },
      el('dt', {}, 'Tool'),
      el('dd', {}, `${a.tool.program} ${a.tool.toolVersion}`),
      el('dt', {}, 'Fork commit'),
      el('dd', { 'data-claim': 'tool-commit' }, a.tool.forkCommit),
      el('dt', {}, 'Upstream baseline'),
      el('dd', {}, a.tool.upstreamBaseline),
      el('dt', {}, 'Platform'),
      el('dd', {}, a.platform),
      el('dt', {}, 'Exit status'),
      el('dd', {}, `${a.exitCode} (errorLevel ${a.errorLevel})`),
      el('dt', {}, 'Hash the tool read'),
      el('dd', {}, a.toolSha256),
      el('dt', {}, 'Symbol width used'),
      el(
        'dd',
        {},
        `${a.bitsPerSymbol} — ${a.bitsPerSymbolInferred ? 'INFERRED by the tool from the data' : 'given on the command line'}`
      )
    ),
    el(
      'div',
      { class: 'verdict verdict-warn', 'data-claim': 'patched-build' },
      el('span', { 'aria-hidden': 'true' }, '⚠'),
      el(
        'span',
        { class: 'verdict-text' },
        el('strong', {}, 'This is a patched build, not NIST’s unmodified reference implementation. '),
        a.tool.patchedBuildNote.replace(/^This is a PATCHED build[^.]*\. /, '')
      )
    )
  );
  return box;
}

/** The whole fixture dossier: badges, blurb, encoding, reproduction, download. */
export function fixtureDossier(f: Fixture): HTMLElement {
  return el(
    'div',
    { class: 'card', 'data-fixture': f.id },
    el('h3', {}, f.title),
    badgeRow(f),
    el('p', {}, f.blurb),
    el('p', {}, downloadLink(f)),
    el('details', {}, el('summary', {}, 'Sample encoding and checksums'), encodingBlock(f)),
    el('details', {}, el('summary', {}, 'Reproduce these figures yourself'), reproductionBlock(f))
  );
}
