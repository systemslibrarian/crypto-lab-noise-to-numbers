/**
 * Descriptive statistics, off the main thread.
 *
 * A million samples with a repeated-block search is comfortably enough to
 * freeze a tab, so it runs here with progress, cancellation and a size cap.
 * It imports the SAME `describe()` the unit tests exercise; there is no second
 * copy of the analysis.
 *
 * The UI terminates and replaces this worker when the visitor cancels or
 * selects a new sample. A posted message alone cannot interrupt these
 * synchronous calculations; terminating prevents unfinished work or a queued
 * result from replacing the cancellation state.
 */
import {
  DESCRIPTIVE_DEFAULTS,
  INPUT_SIZE_CAP,
  InputTooLargeError,
  describe,
  type DescriptiveStats,
} from '../entropy/descriptive.ts';
import { unpackBits } from '../entropy/encoding.ts';

export interface AnalyseRequest {
  kind: 'analyse';
  runId: number;
  bytes: ArrayBuffer;
  /** How the bytes are laid out, so the worker reads the right samples. */
  form: 'packed-bits' | 'one-sample-per-byte';
  bitsPerSymbol: number;
  /** Required for a packed input; a packed file does not record it. */
  sampleCount: number | null;
}

export interface CancelRequest {
  kind: 'cancel';
  runId: number;
}

export type WorkerRequest = AnalyseRequest | CancelRequest;

export type WorkerResponse =
  | { kind: 'progress'; runId: number; fraction: number }
  | { kind: 'done'; runId: number; stats: DescriptiveStats }
  | { kind: 'cancelled'; runId: number }
  | { kind: 'error'; runId: number; message: string; code: 'too-large' | 'bad-input' | 'failed' };

class Cancelled extends Error {}

let cancelledRun: number | null = null;

const post = (m: WorkerResponse): void => {
  (self as unknown as { postMessage: (m: WorkerResponse) => void }).postMessage(m);
};

self.onmessage = (ev: MessageEvent<WorkerRequest>): void => {
  const msg = ev.data;
  if (msg.kind === 'cancel') {
    cancelledRun = msg.runId;
    return;
  }

  const { runId, form, bitsPerSymbol, sampleCount } = msg;
  const bytes = new Uint8Array(msg.bytes);

  try {
    if (bytes.length > INPUT_SIZE_CAP) throw new InputTooLargeError(bytes.length);

    let samples: Uint8Array;
    if (form === 'packed-bits') {
      if (sampleCount === null) {
        throw new RangeError(
          'a packed-bit input needs an explicit sample count: the file does not record how many ' +
            'of its final byte’s bits are real samples'
        );
      }
      samples = unpackBits(bytes, sampleCount, 'msb-first');
    } else {
      samples = bytes;
    }

    let lastSent = -1;
    const stats = describe(samples, {
      ...DESCRIPTIVE_DEFAULTS,
      bitsPerSymbol,
      checkCancelled: () => {
        if (cancelledRun === runId) throw new Cancelled();
      },
      onProgress: (f) => {
        // Coalesce: a post per percent is plenty and keeps the host's
        // rendering off the critical path.
        const pct = Math.floor(f * 100);
        if (pct !== lastSent) {
          lastSent = pct;
          post({ kind: 'progress', runId, fraction: f });
        }
      },
    });

    post({ kind: 'done', runId, stats });
  } catch (e) {
    if (e instanceof Cancelled) {
      post({ kind: 'cancelled', runId });
      return;
    }
    if (e instanceof InputTooLargeError) {
      post({ kind: 'error', runId, message: e.message, code: 'too-large' });
      return;
    }
    if (e instanceof RangeError) {
      post({ kind: 'error', runId, message: e.message, code: 'bad-input' });
      return;
    }
    post({
      kind: 'error',
      runId,
      message: e instanceof Error ? e.message : String(e),
      code: 'failed',
    });
  }
};
