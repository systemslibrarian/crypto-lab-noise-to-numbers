# SPIKE — can the SP 800-90B estimators run in a browser?

**Deliverable:** a go/no-go on compiling the NIST SP 800-90B non-IID estimators
to WebAssembly, so that v3 of this lab could assess a visitor's own file
instead of showing "SP 800-90B assessment not run on this modified file."

**This spike does not block v1.** v1 ships with every figure coming from a
pinned native run on an exact file, which is the arrangement invariant I1
describes. The spike exists to find out what v3 would cost.

**Verdict: GO, with one hard constraint and one open question.** The constraint
is memory. The open question is floating-point reproducibility, and it is the
one that decides whether a browser engine may ever print a number beside a
native one.

All measurements below were taken on 2026-10-01, macOS 26.6.2, Apple silicon
(arm64), Apple clang 21.0.0, against the build this repository's fixtures were
assessed with.

---

## 1. The pin

| | |
|---|---|
| Upstream | `usnistgov/SP800-90B_EntropyAssessment` |
| Upstream baseline commit | `87c104d0ed4cbc96103e7b8b38d6f2c7e0a6b289` |
| Fork used here | `systemslibrarian/SP800-90B_EntropyAssessment` |
| Program | `ea_non_iid` only |
| Tool version string | `1.1.8` |

The upstream baseline is read from the fork's own `NOTICE`, not from memory,
and `scripts/assess-fixtures.ts` records it into every manifest entry. The
`fixtures.yml` CI job reads the pinned fork commit back **out of the manifest**
and checks out exactly that, so there is one place the pin lives.

---

## 2. Dependency inventory — from the build files, not from memory

Read from `cpp/Makefile` at the pinned commit. `LIB` and `SHARED_LIB` (used by
every program) name `-lbz2 -lpthread -ldivsufsort -ldivsufsort64 -ljsoncpp
-lcrypto`; `COND_LIB = -lmpfr -lgmp` is passed **only** in the
`ea_conditioning` rule.

`otool -L` on the built `ea_non_iid` confirms what actually got linked:

| Library | Role | WASM story |
|---|---|---|
| `libdivsufsort` + `libdivsufsort64` | suffix arrays for the t-tuple and LRS estimators | **Must be ported.** Plain C, no syscalls, no threading. The 64-bit variant is the one that matters at 8 bits per symbol. |
| `libjsoncpp` | the JSON report | **Drop it.** The report is the C++ side's output format; a WASM build hands structured values back to JS directly. |
| `libcrypto` (OpenSSL 3.6.4) | SHA-256 of the input file, in `shared/TestRunUtils.h` | **Replace with WebCrypto.** This is the single use; pulling OpenSSL into WASM for one hash would be absurd. |
| `libbz2` | on the link line for every program | **Not needed.** `ea_non_iid` references no symbol from it — only `cpp/iid/permutation_tests.h` does, and that is the IID track. |
| `libomp` | OpenMP runtime | **Not needed — see §3.** |
| `libc++`, `libSystem` | C++ standard library, pthreads | Supplied by the Emscripten toolchain. |

No MPFR and no GMP appear in the link line, which is the fork's documented LGPL
isolation and is re-verified here.

---

## 3. Threading — there is none to port

`ea_non_iid` contains **zero** OpenMP pragmas. Measured by grep over its own
sources plus `cpp/shared/`:

| Program | `#pragma omp` occurrences |
|---|---|
| `ea_non_iid` | **0** |
| `ea_iid` | 5 |
| `ea_restart` | 2 |

The OpenMP runtime is on `ea_non_iid`'s link line only because
`cpp/shared/utils.h:19` does `#include <omp.h>` unconditionally. So the
non-IID track is already single-threaded, and the "OpenMP → Web Workers"
question the brief asks about **does not arise for the program this lab needs**.
It would arise for `ea_iid`, which is not in scope here.

A consequence worth stating: `ea_non_iid` is run-to-run deterministic. The same
binary on the same input produced byte-identical `-vv` output across repeated
runs (verified: identical MD5 of the full verbose output). `ea_iid` is not —
its permutation tests seed from `/dev/urandom`, and on a marginal dataset its
pass/fail verdict can differ between runs of the same binary.

---

## 4. Peak memory — the hard constraint

Measured with `/usr/bin/time -l`, maximum resident set size, on 1,000,000-sample
inputs:

| Input | Symbol width | Peak RSS |
|---|---|---|
| `inm-clean.samples.bin` | 1 bit | **19.9 MB** |
| `fault-predictable.samples.bin` | 1 bit | **19.9 MB** |
| `counter-hash-sha256.samples.bin` | 8 bits | **325.0 MB** |
| `inm-conditioned-keccak.samples.bin` | 8 bits | **325.0 MB** |

**This is the finding that shapes v3.** A 1-bit assessment is trivial for a
browser. An 8-bit assessment at the standard's minimum sample count needs about
325 MB of contiguous linear memory — and wasm32 caps a module's memory at 4 GiB
in principle but far less in practice: a single `WebAssembly.Memory` growth to
325 MB is routinely refused on mobile Safari and on any tab already under
pressure, and the allocation must be contiguous.

What follows for v3:

- A 1-bit engine is unconditionally viable.
- An 8-bit engine must either declare a memory budget up front and fail
  **before** starting (the fail-closed direction, matching how this lab already
  treats a sub-minimum file), or move to `wasm64` where support allows.
- The 16× jump from 1-bit to 8-bit is not the sample array — that is 1 MB
  either way. It is the bit-string branch: at 8 bits per symbol the tool builds
  and analyses an 8,000,000-sample derived bit string **in addition to** the
  literal one, and the t-tuple and LRS suffix arrays over it dominate.

---

## 5. Runtime — comfortable either way

Wall-clock, native, same machine:

| Input | Symbol width | Wall |
|---|---|---|
| `inm-clean` | 1 bit | **0.25 s** |
| `fault-bias` | 1 bit | **0.21 s** |
| `fault-predictable` | 1 bit | **0.27 s** |
| `counter-hash-sha256` | 8 bits | **5.48 s** |
| `inm-conditioned-keccak` | 8 bits | **5.12 s** |

WASM typically lands within 1.2–2× of native for this kind of integer and
suffix-array work. So a 1-bit assessment is sub-second in a browser and an
8-bit one is roughly 6–11 seconds — long enough to need the progress and
cancellation machinery, which this lab already has for its descriptive
statistics (`src/worker/descriptive.worker.ts`) and could reuse unchanged.

---

## 6. File I/O shims

`ea_non_iid` touches the filesystem in exactly three places, all shallow:

1. `read_file()` / `read_file_subset()` in `cpp/shared/utils.h` — a `stat` for
   the length and one `fread` of `len` bytes into a `uint8_t` array. In a WASM
   build this becomes "here is an ArrayBuffer"; no MEMFS needed.
2. `sha256_file()` in `cpp/shared/TestRunUtils.h` — replaced by WebCrypto.
3. The `-o` JSON report write — replaced by returning values to JS.

There is no directory traversal, no temporary file, and no mmap. This is the
easiest part of the port.

---

## 7. Floating-point reproducibility — the open question

**This is the one that decides whether v3 may print a browser figure beside a
native one.**

The fork already documents a platform-dependent divergence at the pinned
commit, and it is not introduced by any change in the fork: on macOS arm64,
three predictor values on `biased-random-bytes.bin` and `ringOsc-nist.bin`
differ from NIST's Linux x86-64 reference data by **1.3e-10 to 3.7e-10**
against the selftest's epsilon of 1e-10. That is upstream issue **#155**, and
it means the tool is *already* not bit-reproducible across platforms today.

Two mechanisms are in play, and they pull in opposite directions:

- `CXXFLAGS` carries `-ffloat-store`, which exists to force x87 intermediates
  to memory. It is a **no-op** on x86-64 (SSE math), on arm64, and in WASM. So
  it does not help.
- WASM's f64 arithmetic is IEEE-754 and strictly defined, with no x87 excess
  precision and no FMA contraction unless explicitly requested. That makes a
  WASM build arguably **more** reproducible than the native landscape, not
  less — but *more reproducible than two things that already disagree* is not
  the same as *agreeing with either of them*.

The library call surface is where this is genuinely unresolved: `log`, `log2`,
`exp`, `pow` and `sqrt` are not correctly-rounded-mandated by IEEE-754, and
glibc, Apple's libm and Emscripten's musl-derived libm give different last
bits. The estimators use these heavily — every `-log2(p)` conversion, the
collision estimate's root-finding, the compression estimate's statistics.

**What this means for v3, and it is a design constraint rather than a
caveat:** a browser engine must be validated against the native tool with a
*stated, measured* tolerance, and the lab must display the tolerance alongside
any browser-computed figure. The honest form is "0.372519 ± 1e-9, computed in
your browser; the native tool on this file gives 0.372519", not a bare number
that looks like the pinned one. Invariant I1 already says a v3 figure must come
from "a browser engine validated against native" — this section is what that
validation has to establish.

**Measuring it is the next step**, and it is not done here: it needs the WASM
build to exist. The experiment is well defined — run both engines over all ten
fixtures and record the maximum relative delta per estimator — and the
reference comparison already exists in `cpp/selftest/compareresults.pl`.

---

## 8. Go / no-go

**GO**, in this order:

1. **1-bit engine first.** 19.9 MB and sub-second. It covers every raw-noise
   fixture this lab has and every capture v2 will add, because the device
   emits bits.
2. **Measure the float deltas** against the native tool over all ten fixtures
   before any figure is shown. Publish the tolerance.
3. **8-bit engine behind a declared memory budget**, failing closed before
   allocation rather than crashing the tab.

**Rust was considered and is not warranted.** The brief says to consider it only
if the spike shows a blocker WASM cannot clear, and nothing above is one: there
is no threading to port, the I/O surface is three functions, and the memory
constraint is a property of the algorithm rather than of the toolchain —
rewriting the suffix-array passes in Rust would need the same 325 MB. A rewrite
would also throw away the thing that makes the figures worth anything, which is
that they come from NIST's own implementation of the estimators rather than
from somebody's reimplementation of the standard.

---

## 9. The fork's divergences from the pinned upstream

`ea_non_iid`, `ea_iid` and `ea_restart` are built from
`systemslibrarian/SP800-90B_EntropyAssessment`, which is **not** byte-identical
to upstream. This lab therefore never claims "assessed with NIST's reference
implementation": it names the patched build, its commit, and the fact that
every change is documented upstream with an issue number. The page says so on
every reproduction block.

`git diff --stat` against the pinned upstream over `cpp/`: **34 files changed,
2,807 insertions, 225 deletions** — the bulk of which is new regression-test
material under `cpp/selftest/`.

### 9a. Build-only changes (no reported figure can change)

| Commit | Change | Reason |
|---|---|---|
| `d240098` | Makefile: add Homebrew include/lib prefixes on Darwin | Locate the dependencies on macOS |
| `06c693c` | Makefile: Apple clang + Homebrew libomp on Darwin | Apple clang rejects a bare `-fopenmp`; Homebrew GCC cannot link Homebrew's libc++-built jsoncpp |
| `7ce69e9` | Makefile: default `ARCH` to host on Apple-silicon | Omits the x86-only `-march=native`, as upstream already does for any non-x86 `ARCH` |
| `b75e763` | `cpp/shared/utils.h`: `#include <climits>` | **Found by this lab's CI.** The `-l` subset overflow check added in `0e1ffcd` uses `ULONG_MAX`, and the header never included `<climits>`. macOS builds anyway because libc++ pulls the declaration in transitively; **Linux with GCC does not, and `make non_iid` fails outright** — so the pinned tool did not build on the platform upstream names as its tested one. Reported and fixed upstream of this lab, in the fork. |

`-std=c++11 -O2 -ffloat-store` are untouched, and no flag affecting
floating-point semantics was added or removed. Non-Darwin command lines are
unchanged.

**On `b75e763` specifically**, because adding an include to a source file is
not a Makefile change and the claim "no reported figure can change" has to be
earned rather than asserted: the commit declares a macro that was already being
used, so it alters no arithmetic, cut-off, rounding or confidence bound.
Verified two ways — `pin-check.sh --prove-nonvacuous` still passes on
`bin/ringOsc-nist.bin` and still fails on the perturbed input; and re-pinning
this repository to the new commit changed exactly ten lines of
`fixtures/manifest.json`, all of them the recorded `forkCommit`. Every
estimator value, both branch minima, every assessed figure, every exit status
and every error message was byte-identical.

### 9b. Estimator and program changes

Each answers an upstream issue. **Validation** is the fork's own
`cpp/selftest/regression-*.sh` suite plus the pinned-output check; the
`fixtures.yml` job in this repository runs `pin-check.sh --prove-nonvacuous`
before letting the build judge anything here.

| Commit | Change | Upstream | Status as the fork records it |
|---|---|---|---|
| `134d377` | Under `-c`, Section 5 IID tests run on the conditioned output as a binary string | #271 | accepted; remedy 1 of two offered |
| `c2f1dcd` | Datasets below 1,000,000 samples are refused before any estimator runs | #257/#258/#261/#263/#264/#255 | the remedy NIST gave |
| `ed88de9` | Binary MultiMMC declines below `D_MMC+1` samples instead of reading past the sample buffer | #257 | NIST called it "a real bug" |
| `c0ee84a` | Compression estimate requires at least two test blocks instead of dividing by `v-1 = 0` | #263 | — |
| `c217f20` | Collision estimate requires at least two collisions; its result guarded in the combination logic | #264 | — |
| `21b0a31` | LRS, lag and LZ78Y decline rather than aborting the process on short or repeat-free input | #261 | — |
| `0e1ffcd` | `-l` subset offset checked for overflow and against file length; subset provenance recorded | #260 | `sha256` still hashes the whole file, which is what NIST asked for |
| `97571de` | JSON records the symbol width used and whether it was inferred | #254 | the half NIST called useful |
| `cdb5cd6` | Non-regular input files refused instead of hanging; hash status checked | #259 | fork hardening; NIST does not regard it as a defect |
| `c8799f4` | **N-01.** A binary chi-square independence test with `m = 1` fails, per SP 800-90B 5.2.3, instead of returning a statistic of 0 on 0 degrees of freedom and reading as a pass | — | **Deliberately changes an IID verdict** |
| `69b6094` | **F09.** A Null prediction from the winning MultiMMC subpredictor ends the run of correct predictions, per SP 800-90B 6.3.9 | — | **Deliberately changes a figure** |
| `6b60f9d` | Compression block indices held in a 64-bit type, with a compile-time guard | F14 | — |
| `dfe325a` | The report records which estimators applied but could not produce a value | F05 | not an error; `errorLevel` stays 0 |
| `9f64f62` | IID: only computed figures reported; the assessed figure no longer depends on verbosity | NOVEL-02 | — |
| `47d6624` | A report that cannot be written fails the run | N-09 | — |
| `db7a2ba`, `23dca69`, `d892b90`, `fd83a43` | Restart: strict `H_I` parsing; read failures recorded on the report actually written; an uncomputable estimate not folded into `H_r`/`H_c`; `sha256_file()` status checked | N-04, R-3, R-2, N-06 | `ea_restart` is not used by this lab |

**Two of these deliberately alter results, and this lab is affected by neither
in a way that moves a displayed figure** — but the reasoning has to be stated
rather than assumed:

- **F09** corrects the MultiMMC run of correct predictions. Where the defect
  bit, the MultiMMC estimate **rises**. Because the reported figure is a
  minimum, an input on which MultiMMC was the binding minimum reports a HIGHER
  figure after this change. MultiMMC is not the binding estimator on any of
  this lab's ten fixtures: Compression binds on five (`inm-clean`,
  `fault-stuck-bit`, `fault-bias`, `fault-periodic`, `fault-predictable`), LRS
  on one (`fault-repeated-block`), T-Tuple on `counter-hash-sha256` and LZ78Y
  on `inm-conditioned-keccak`. The remaining two — `exploratory-short` and
  `all-zero` — have no assessment at all, because the tool refused both. All
  eight that do bind through the literal branch. So no figure here is affected — which is a
  measured property of these fixtures rather than a general claim, and
  `fixtures.yml` would catch it changing.
- **N-01** changes an IID *verdict*, not a min-entropy figure, and this lab
  runs only the non-IID track.

### 9c. The fork's audit status, as the fork documents it

Stated only as the fork states it, with no characterisation added here. From
`audits/README.md` and `audits/2026-09-30/`:

- The audit work dates from 2026-09-30 and audits upstream `87c104d`.
- **AI-assisted analysis was used; confirmed findings were reproduced on clean
  builds.**
- **"Nothing here is an official NIST conclusion."** The reports are historical
  records.
- An upstream issue being closed does not mean the bug is resolved; the
  tracker, not the issue state, is the work queue.
- The fork's `NOTICE` additionally records that this patched build is now a
  product dependency of TruePad, that the bar for a fix is therefore
  independent reviewability rather than upstream acceptance, and that the
  single pinned-output check is "necessary but no longer sufficient" for a
  patched build — per-change expected values are required, which is what the
  `regression-*.sh` suite provides.

One item is deliberately **not** changed, pending NIST: the treatment of a
two-symbol alphabet as binary regardless of the declared sample width (#253, PR
#256). The fork follows upstream's behaviour unchanged.
