# NEW DEMO BRIEF — crypto-lab-noise-to-numbers

Repo name:       crypto-lab-noise-to-numbers
Short name (H1): Noise to Numbers
Subtitle:        NIST SP 800-90B · entropy assessment
One-liner:       Follow physical noise from the circuit to the cryptographic byte — and see what evidence does and does not support trusting it.
Concept:         Entropy is a property of a source model, not of a byte string. Statistical randomness is not unpredictability; conditioning concentrates entropy but never creates it.
Primitives/spec: NIST SP 800-90B (IID and non-IID tracks, min-entropy estimation, restart testing, health tests §4.4, conditioning §3.1.5); Infinite Noise TRNG modular-multiplication design; the infnoise driver's conditioning construction (verify from driver source before naming it).
--accent:        TBD — assigned centrally; must differ from neighbouring catalog cards
Favicon:         🌡️ (proposal)
Category:        RANDOMNESS if that category exists — grep CATEGORIES and report. Also grep the catalog for existing labs covering entropy, TRNG, DRBG, OTP, or SP 800-22/90B and report overlap before building. Do not assume this lab is the first.

## Step 0 — verify before building
Read the repo's _MASTER-TEMPLATE.md / kickoff.md and confirm that e2e/claims.spec.ts and §4.1b, §4.1c, §4.1d exist as this brief describes. If any differ, follow the template and report the mismatch. Do not invent a replacement mechanism.

## Central question
"These bytes look random. What evidence supports trusting them?"

## Headline mechanism (show, don't tell) — an experiment, not a predetermined result
Generate a documented counter-hash stream: exact hash function, counter encoding, start value, length, and the generation script, all in the repo. Run the pinned NIST tool on it and on the raw-noise fixture, and report the actual min-entropy estimates as measured.
The lesson: a publicly reproducible deterministic stream can receive high statistical estimates while being fully predictable to anyone who knows its construction. That is why 90B assesses the raw noise source before conditioning.
Do not fix the expected numbers in advance. After measuring, record the observed values, their units, and the threshold the lab will call "high." Then pin that threshold in the claims tests.

## Release split
v1 (ships before hardware; no WASM dependency):
- The native NIST tool runs offline. Every 90B result displayed comes from a pinned native run on that exact file.
- Fault variants are PREDEFINED fixtures (stuck bit, bias, periodic, repeated block, predictable sequence), each with its own pinned native result.
- Custom visitor modifications update descriptive statistics only. Those views show: "SP 800-90B assessment not run on this modified file."
- Browser computes only descriptive statistics live: bit balance, run lengths, lag-k autocorrelation, repeated-block search. These are labeled "descriptive — not an SP 800-90B estimator."
- Fixtures are SIMULATED, including a software model of the modular-multiplication circuit with injected Gaussian noise. That model is labeled as a model, not hardware.
v2 (extension brief, after the device arrives): real captures, restart testing, driver health-check investigation, published capture sets.
v3 (extension brief, gated on the spike): browser 90B engine, which allows assessment of custom files.
The WASM feasibility spike is a separate deliverable (SPIKE.md) and does not block v1.

## Learning journey (acts)
1. Meet the source. Thermal noise, the modular-multiplication loop, physical entropy vs deterministic expansion. Plain language before any hex. Verify the device's theoretical entropy-rate claim from the infnoise source or docs and cite it. Label it as a theoretical design rate, distinct from any measured min-entropy estimate.
2. Inspect raw samples. Balance, runs, correlations. Explain why this design's raw output is expected to be correlated and is therefore assessed on the non-IID track.
3. Assess entropy. Show each non-IID estimator's result individually, the minimum taken across them, and each estimator's assumptions. Say "min-entropy" throughout, never bare "entropy," and always state units (bits per sample, plus bits per bit where the conversion is meaningful). Warnings and failures are first-class states.
4. Break the stream. Compare the predefined fault fixtures against the clean fixture using their pinned results. The table records which estimators moved and which did not, as measured. Do not assume every estimator catches every fault. Custom modifications follow the v1 rule above.
5. Follow conditioning. Run the headline experiment here. If the infnoise driver exposes an output-rate multiplier (verify before naming it), show that raising bytes out does not raise entropy in.
6. One-time pad. In-lab XOR demo using a public, disposable pad. Show that a public pad gives zero secrecy, that pad length must be at least message length, and what a two-time pad leaks. An outbound link to truepad.app is optional; the lab has no dependency on TruePad code.

## SCOPE / NON-GOALS
In scope: the acts above, fixture downloads, and native-tool reproduction instructions.
Non-goals:
- Not certification or validation (not ESV, not CMVP).
- No claim that any device is fit for production key generation.
- No SP 800-22 battery. Name it only to contrast statistical tests with entropy assessment.
- No product endorsement. The Infinite Noise device is the studied source, not a recommendation.
- No server. User files never leave the browser.

## SECURITY / CORRECTNESS INVARIANTS (beat features on conflict)
I1. Every displayed 90B number belongs to the exact file being viewed. It comes from that file's pinned native run (v1) or from a browser engine validated against native (v3). Nothing is hand-entered, and no result is shown for a file it was not computed on.
I2. Partial estimator coverage is labeled "partial" everywhere results appear.
I3. Simulated, modified, and real data each carry a persistent provenance badge. Badges are distinct and not color-only.
I4. Public fixtures and everything derived from them are marked "never a secret."
I5. Conditioned output is never presented as evidence of source entropy.
I6. Teaching examples below the sample minimum are labeled "exploratory — below the 1,000,000-sample minimum for a full assessment." Only fixtures meeting the minimum are presented as full runs.

## SAMPLE ENCODING (required in every fixture manifest)
- Packed bits and one-sample-per-byte files are different inputs. Document the exact conversion procedure (bit order, bits_per_symbol), and record SHA-256 checksums for both the original and the converted file.
- State how an incomplete final sample is handled: dropped, padded, or rejected. Never handle it silently.
- Record estimator units for each result.
- Verify the tool's input format and flags from its README at the pinned commit.

## ARCHITECTURE
TS/Vite per the template. Descriptive stats run in a Web Worker with progress, cancellation, and an input-size cap.
Fixture manifest (JSON) per file: provenance class, generator script or capture procedure, encoding block (above), sample count, original and converted SHA-256, tool commit, exact command, recorded results.

## WASM FEASIBILITY SPIKE (SPIKE.md)
- Pin a usnistgov/SP800-90B_EntropyAssessment commit.
- Inventory dependencies from its build files, not from memory.
- Cover: threading (OpenMP → Workers, or single-thread), peak memory on a 1M-sample input, file I/O shims, and floating-point reproducibility vs native.
- Deliverable: a go/no-go with measured runtimes.
- List each divergence in systemslibrarian/SP800-90B_EntropyAssessment against the pinned upstream, with its reason and validation. Describe the fork's audit status only as documented in the fork.
- Consider Rust only if the spike shows a blocker WASM can't clear.

## UI / VISUAL SEMANTICS
- Hero roles stay distinct: subtitle = spec label; description = what is demonstrated; "Why it matters" = real-world RNG failures (verify any named incident against a primary source).
- Never draw a picture implying entropy increases through conditioning.
- No decorative motion.

## EDGE CASES
Empty file; file under the sample minimum; wrong bits_per_symbol; incomplete final sample; file over the cap; cancellation mid-run; all-zero file; packed-bit file loaded as byte samples.

## TESTS (existing mechanisms — confirmed in Step 0)
- Independent fixture check: a CI job builds the pinned NIST tool from source, reruns every fixture's recorded command, and fails on any mismatch with the manifest. This checks fixture generation, not just table-vs-fixture agreement. If CI time is prohibitive, report that and propose a scheduled job instead.
- e2e/claims.spec.ts (§4.1b): every displayed result matches its manifest. Descriptive stats are independently recomputed. The headline-experiment threshold is the one recorded after measurement.
- §4.1c mutation: every rendered verdict, warning, "partial," "exploratory," and "assessment not run" label must fail under mutation. No canned verdicts.
- §4.1d negative claims: each honesty-panel line is a tested negative claim, scoped exactly as written.
- §4 axe/WCAG gate.

## HONESTY PANEL (each line maps to a §4.1d test)
- Passing statistical tests does not prove unpredictability.
- A min-entropy estimate depends on its assumptions and on how the input is interpreted.
- High entropy estimates on conditioned output do not establish the raw source's entropy or unpredictability.
- Health tests detect gross failures. They are evidence, not proof against every attack.
- This lab is not NIST certification, validation, or approval.
- Conditioned output still needs a justified entropy budget from the raw source.
- Public randomness supports research and demos. It can never be a secret pad.

## EXTENSION SEAMS
- The fixture manifest schema accepts real captures (v2) without UI changes.
- The estimator-results interface has the same shape whether results come from pinned fixtures or the live engine (v3). In v3, the "assessment not run" state is replaced by a live run.

## DEFINITION OF DONE (v1)
A visitor can:
1. Download a documented fixture.
2. Reproduce its 90B results with the native tool using the listed command.
3. Compare predefined fault variants against the clean fixture.
4. Run the counter-hash experiment.
5. State what the results establish and what they leave uncertain.
All CI checks pass: the fixture rerun, claims, mutation, and axe.

## OPEN (Paul)
- --accent, favicon, category placement.
- Licence check on any third-party sample data; use synthetic only if unclear.
- Whether a public lab should link the paid TruePad app.