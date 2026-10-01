# Noise to Numbers — crypto-lab

**NIST SP 800-90B · entropy assessment.** Follow physical noise from the circuit
to the cryptographic byte — and see what evidence does and does not support
trusting it.

**Live demo:** https://systemslibrarian.github.io/crypto-lab-noise-to-numbers/

---

## What It Is

An interactive, browser-only lab about **entropy assessment**: the business of
establishing how much unpredictability a source actually has, which is what
NIST **SP 800-90B** exists to specify. It studies one real design — the
**Infinite Noise** modular entropy multiplier — through a software model of its
circuit, and runs the **real NIST assessment tool** over documented fixtures.

The concept it teaches: **entropy is a property of a source model, not of a byte
string.** Statistical randomness is not unpredictability, and conditioning
concentrates entropy but never creates it.

The lab demonstrates that rather than asserting it. A stream whose entire
construction is published here — SHA-256 over a little-endian counter, starting
at zero — was assessed at **0.919220 bits of min-entropy per bit**. The modelled
physical noise source was assessed at **0.372625**. The stream anyone can
regenerate from four lines of description scored **2.47 times higher** than the
one driven by thermal noise. Nobody decided those numbers in advance; they are
what the tool reported, and the page shows you how to reproduce them.

**Primitives and specs.** NIST SP 800-90B (non-IID track, ten estimators,
§3.1.1's 1,000,000-sample minimum, §3.1.5 conditioning, §4.4 health tests named
for contrast); Keccak-f[1600] as the Infinite Noise driver uses it; SHA-256;
the one-time pad.

**Not production crypto — a teaching demo.** It is **not** NIST certification,
validation or approval; not ESV and not CMVP. No device is claimed fit for
production key generation. There is no server: your files never leave the
browser.

### What is real, what is modelled, and what is pinned

| | |
|---|---|
| **Real** | Every min-entropy figure. Each comes from a pinned native run of `ea_non_iid` on one exact file, recorded with that file's SHA-256, the exact command, the tool commit and the platform. |
| **Real** | The Keccak-f[1600] permutation, hand-rolled in `src/entropy/keccak.ts` and checked against the FIPS 202 SHA3-256 digests built from the same permutation. |
| **Real** | The driver's sponge construction, the counter-hash stream, the packing arithmetic, every descriptive statistic, and the one-time-pad XOR. |
| **Modelled** | The noise source. `src/entropy/inm-model.ts` is a software model of the vendor's own `updateA()` loop with bell-shaped noise injected (Irwin-Hall, so that fixture generation is bit-reproducible across engines — see `src/entropy/prng.ts`). It is **not hardware** and not a capture from hardware, and it is badged "Simulated" everywhere it appears. |
| **Pinned, not computed here** | Nothing is assessed in your browser. The browser computes **descriptive statistics only** — bit balance, run lengths, lag-k autocorrelation, repeated-block search — each labelled "descriptive — not an SP 800-90B estimator". |

### The one thing to know about the tool

The figures come from a **patched build**, not NIST's unmodified reference
implementation: `systemslibrarian/SP800-90B_EntropyAssessment`, a fork of
upstream `87c104d0ed4cbc96103e7b8b38d6f2c7e0a6b289`. Every divergence is listed
with its reason, its upstream issue and its validation in
[SPIKE.md §9](SPIKE.md). The page says so on every reproduction block, because
"assessed with NIST's reference implementation" would not be true.

---

## Exhibits

1. **Meet the Source** — step the modular-multiplication loop yourself and watch
   the state fold across the threshold and emit a bit. Sets the vendor's
   *theoretical design rate* (log₂(1.82) = 0.863938 bits per bit) beside the
   *measured* estimate for the modelled stream (0.372625), and keeps them
   apart.
2. **Inspect Raw Samples** — descriptive statistics in a Web Worker, with
   progress, cancellation and a size cap. Load a shipped fixture or your own
   file; re-read the same bytes at a different symbol width and watch the
   recorded assessment be withdrawn.
3. **Assess Min-Entropy** — all ten non-IID estimators individually, each with
   its own figure, its own unit and its own stated assumption; the binding one
   highlighted; and the combination rule shown rather than asserted. Warnings
   and failures are first-class: the sub-minimum fixture shows the tool's own
   refusal, verbatim, and no figure at all.
4. **Break the Stream** — five predefined fault fixtures against the clean one,
   each with its own pinned run. The table records which estimators moved and
   which did not, as measured. **Three of the five broken streams report a
   higher figure than the clean one** — not because the faults went unnoticed,
   but because the reported figure is a minimum and the binding estimator
   improved on the broken file.
5. **Follow Conditioning** — the headline experiment, then the driver's Keccak
   sponge with its output multiplier under your control. Two bars to the same
   scale: raising the multiplier grows the output bar and leaves the entropy bar
   exactly where it is.
6. **One-Time Pad** — encrypt with a pad published in this repository, then
   decrypt it without being told any secret. Plus the length condition and the
   two-time-pad leak. Deliberately brief: for the pad itself, see
   [crypto-lab-otp-vault](https://systemslibrarian.github.io/crypto-lab-otp-vault/).

---

## When to Use It

- **To learn why a passing statistics check is not evidence of
  unpredictability** — this is the lab's central demonstration, with measured
  numbers rather than a warning box.
- **To understand what an SP 800-90B estimate actually claims** — which model,
  which assumptions, which units, and why the minimum is taken.
- **To see an entropy budget done as arithmetic** rather than asserted.
- **Do NOT use it to evaluate a device.** It assesses a *model* of a circuit on
  *simulated* data. It tells you about the model.
- **Do NOT use it as a certification aid.** It is not ESV, not CMVP, and the
  tool it runs is a patched build.
- **Do NOT use anything it ships as key material.** Every fixture is published
  here and badged "never a secret".

---

## Live Demo

https://systemslibrarian.github.io/crypto-lab-noise-to-numbers/

You can: step the circuit; analyse any of ten fixtures or your own file; read
every estimator's figure and assumption; compare five faults against the clean
stream; regenerate the "random-looking" counter-hash stream live in your
browser from its published construction; drive the conditioning ledger; and
decrypt a message using a pad this repository prints.

And you can **reproduce every figure the page shows**, with the commands the
page gives you.

---

## What Can Go Wrong

Each of these is a reachable state in the lab, not a hypothetical.

- **A file below the sample minimum.** SP 800-90B §3.1.1 asks for 1,000,000
  samples. The tool *refuses* — exits non-zero and writes an error — and the lab
  shows that refusal rather than a smaller number. `exploratory-short` exists to
  make this visible.
- **Packed bits read as byte samples.** A 1,000,000-sample packed file is
  125,000 bytes. Hand it to the tool as byte samples and you assess 125,000
  samples, not 1,000,000 — one eighth as many, and below the minimum. The
  encoding block in every manifest entry records both forms, both checksums,
  and the exact conversion.
- **The wrong `bits_per_symbol`.** Re-read a fixture at the wrong width in Act 2
  and the lab withdraws its recorded figure, because the figure was measured for
  a different reading of those bytes.
- **An estimate on conditioned output.** It looks excellent whatever went in,
  because a good hash produces uniform-looking bytes from anything. Act 5 shows
  the same source crossing the lab's "high" line purely by being conditioned.
- **A fault that raises the number.** Act 4, measured. A rising figure is not
  evidence that nothing is wrong.
- **An all-zero file.** `all-zero` meets the sample minimum and is still
  refused, for a different reason than a short one: an alphabet of one symbol.
  The lab shows both refusals, because they are different findings.
- **An empty file, a cancelled run, a file over the cap.** Each has its own
  named state; none is silently treated as "zero entropy", which is a different
  claim from "no evidence".

---

## Real-World Usage

Entropy assessment is not academic. Two incidents motivate the whole subject,
and both are cited on the page:

- **Debian's OpenSSL PRNG, 2008 (DSA-1571-1).** A patch removed the lines that
  stirred uninitialised memory into the pool, leaving the generator seeded by
  little more than a process id. Every key generated on an affected system for
  two years came from a space small enough to enumerate.
- **"Mining Your Ps and Qs", USENIX Security 2012.** Heninger, Durumeric,
  Wustrow and Halderman scanned the public internet and computed the private
  keys of **0.50% of TLS hosts**, from primes shared because devices generated
  keys before they had any entropy.

In both cases the output looked fine. That is the point of assessing the
*source* rather than the bytes.

SP 800-90B itself is the basis of NIST's Entropy Source Validation (ESV)
programme, which is a prerequisite for FIPS 140-3 validation of anything that
generates keys.

---

## How to Run Locally

```sh
npm install
npm run dev          # http://localhost:5173/crypto-lab-noise-to-numbers/
```

Other scripts:

```sh
npm test             # the unit and correctness suite (113 tests)
npm run build        # type-check and build
npm run test:claims  # the claims suite, against the production build
npm run test:a11y    # the WCAG 2.1 A/AA gate, against the production build
```

### Reproducing the lab's figures

Every figure the page shows can be re-measured. The page gives you the exact
commands per fixture; the shape is:

```sh
# 1. build the pinned assessment tool (full recipe in SPIKE.md)
git clone https://github.com/systemslibrarian/SP800-90B_EntropyAssessment
cd SP800-90B_EntropyAssessment && git checkout <the commit the page shows>
brew install libomp libdivsufsort jsoncpp openssl@3   # or the apt equivalents
cd cpp && make non_iid

# 2. convert the shipped fixture to the one-sample-per-byte form the tool reads
node scripts/unpack-bits.ts fixtures/inm-clean.bin 1000000 msb-first inm-clean.samples.bin
#    the result must hash to the convertedSha256 the page prints

# 3. run the assessment
./ea_non_iid -i -a -vv -o report.json inm-clean.samples.bin 1
```

### Regenerating the fixtures and the manifest

```sh
npm run fixtures:gen      # rebuild every fixture from its generator
npm run fixtures:assess   # rebuild AND re-measure, rewriting fixtures/manifest.json
npm run fixtures:verify   # regenerate and re-measure, failing on any disagreement
```

`fixtures/manifest.json` is **generated**. Nothing in it is typed by hand.

---

## Related Demos

- [crypto-lab-quantum-entropy](https://systemslibrarian.github.io/crypto-lab-quantum-entropy/)
  — the other half of the stack: a modelled QRNG, min-entropy accounting,
  von Neumann debiasing, a Toeplitz extractor, and the SP 800-90B §4.4 health
  tests. Where this lab *assesses a file*, that one *runs the pipeline*.
- [crypto-lab-drbg-arena](https://systemslibrarian.github.io/crypto-lab-drbg-arena/)
  — what happens after the entropy source: HMAC_DRBG, CTR_DRBG and Hash_DRBG,
  with live SP 800-22 statistical tests. The contrast with this lab is the
  point: SP 800-22 tests a *bit string*, SP 800-90B assesses a *source*.
- [crypto-lab-entropy-collapse](https://systemslibrarian.github.io/crypto-lab-entropy-collapse/)
  — the failure mode where the generator is flawless and the *seed* is not.
- [crypto-lab-otp-vault](https://systemslibrarian.github.io/crypto-lab-otp-vault/)
  — the one-time pad and the two-time-pad attack in full.

---

## Build & Verify

**113 unit tests** (Vitest), **23 claims tests** and **2 accessibility scans**
(Playwright), plus an independent fixture-verification job.

| Check | What it establishes |
|---|---|
| **Known-answer tests** | The hand-rolled Keccak-f[1600] is checked by building SHA3-256 from it and comparing against the FIPS 202 digests for the empty string, `abc` and the 56-byte vector — *and* against Node's own `crypto.createHash('sha3-256')` across ten message lengths spanning the rate boundary. Two independent oracles: a memorised constant could be misremembered, and agreement with Node alone proves only that two things agree. |
| **Vendor-transcription tests** | `inm-model.test.ts` pins the parts of the vendor's `updateA()` that are easy to "tidy" into something else — the second noise application on the zero branch, the clamp at the top of the call — and measures the correlation the vendor's README warns about. |
| **Determinism KAT** (`prng.test.ts`) | Pins the exact generator stream, asserts every noise draw is an exact multiple of 2⁻²⁴, and fails if `prng.ts` ever reaches for `Math.log`/`sin`/`cos`/`exp`/`pow` again. It exists because this repository shipped a real reproducibility bug: Box-Muller noise made the fixtures engine-dependent, and the eight-million-sample conditioned fixture regenerated to different bytes on Linux than on the machine that measured it. See below. |
| **Manifest validation** | `validateManifest()` fails closed on a figure attributed to a file whose hash does not match, an assessed value that is not the combination of its own estimators, a full run recorded against a below-minimum file, or an unflagged partial run. The page renders the failure instead of the lab. |
| **Claims suite** (`e2e/claims.spec.ts`) | Every displayed figure matches its manifest entry; the descriptive statistics are **independently recomputed** from the fixture's own bytes by a different route; the counter-hash stream is regenerated with Node's crypto and compared against both the page's WebCrypto output and the shipped file; the fault table's movements are re-derived from their own two endpoints; and the headline threshold is read out of the source. |
| **Negative claims** (§4.1d) | Each line of the honesty panel is a tested claim with an evidence fixture: a reachable state where every check the page performs reports success *and* the named property is violated anyway. |
| **Mutation ledger** (`e2e/mutations.ts`, `scripts/mutate.mjs`) | 12 mutations recorded as concrete patches — file, a once-only anchor, its replacement, the owning test and the marker. A kill requires the owning test to have passed unmutated, the patch to have changed the file, the bundle hash to have moved, and the build to have succeeded. **12 of 12 kill.** A run in which a ledger entry's check never executed **fails**. Two entries are owned by unit tests rather than the browser suite, because the branches they cover are unreachable through any fixture this lab can ship — which the mutation run is what established. |
| **Independent fixture check** (`.github/workflows/fixtures.yml`) | Builds the pinned NIST tool from source, checks it against upstream's own pinned figure non-vacuously, regenerates every fixture from its generator, reruns every recorded command, and fails on any disagreement — every estimator, both branch minima, the exit status and the error message. This checks fixture *generation*, not just table-vs-fixture agreement. |
| **Accessibility gate** | `@axe-core/playwright`, WCAG 2.1 A/AA, over the production build at desktop and 380px, driving every state the lab renders — including the refusals, the "assessment not run" state and the pad failure, which is where this lab's most important sentences live. Zero violations, zero unexplained `incomplete` results, arithmetic contrast over every text node including `aria-hidden` ones, a measured non-text-contrast oracle with an **empty** baseline, and reflow. |

### What the gates actually caught

None of these were hypothetical, and all were fixed in the source rather than
suppressed.

- **The a11y gate** found three defects while being wired: a `[hidden]`
  progress bar that kept painting because a class rule outranked the UA's
  `[hidden]` rule, an `aria-label` on a role-less `<p>` (which axe reports only
  in its `incomplete` bucket, so a violations-only gate never sees it), and
  control boundaries at 2.30–2.51:1 against a 3:1 requirement.
- **The mutation run** found that the partial-coverage branch is unreachable
  through any shipped fixture, and that deleting the "assessment not run" guard
  does not compile and so was never a kill. Both ledger entries were moved to
  checks that genuinely bite rather than left reading as passes.
- **The independent fixture check** found two things the other gates could not.
  First, the pinned NIST tool **did not build on Linux at all** — `ULONG_MAX`
  used without `<climits>`, which macOS's libc++ supplies transitively and
  GCC's libstdc++ does not — so the repository's own reproduction instructions
  were unusable for most readers. Second, and worse, **the fixtures were not
  reproducible**: the generator drew noise with Box-Muller, whose `Math.log`,
  `Math.sin` and `Math.cos` ECMAScript explicitly leaves
  implementation-approximated. The modular-multiplication map is chaotic by
  design, so one differing ulp diverged every sample after it, and the
  eight-million-sample conditioned fixture regenerated to completely different
  bytes on the CI runner. Noise is now drawn by Irwin-Hall, which uses only
  exactly-specified arithmetic, and `prng.test.ts` pins the stream so it cannot
  drift again silently.

That last one is the reason this job exists. Every other check in the table
would have passed a lab whose central claim — regenerate this file and get
these numbers — was false.

---

## Performance

| | |
|---|---|
| Page weight | ~110 kB JS (29 kB gzipped), ~11 kB CSS |
| Fixtures | 10 files, 2.8 MB total, fetched on demand |
| Descriptive analysis | 1,000,000 samples in a Web Worker, with progress and cancellation; 16 MB input cap |
| Native assessment (not in the browser) | 0.21–0.27 s at 1 bit/sample, 5.1–5.5 s at 8 bits/sample; 19.9 MB and 325 MB peak RSS respectively — see [SPIKE.md](SPIKE.md) |

---

*One of the browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
