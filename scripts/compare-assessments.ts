/** Run both native tools on the SAME one-bit-symbol files. No hand-entered results.
 * node scripts/compare-assessments.ts --fork ../entropy-fork --theseus ../theseus --write
 * Replace --write with --verify to reproduce the recorded numerical results.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateInmSamples } from '../src/entropy/inm-model.ts';
import { xoshiro128ss } from '../src/entropy/prng.ts';
import { packBits, unpackBits } from '../src/entropy/encoding.ts';
import { validateComparison } from '../src/entropy/comparison.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(name); if (i < 0 || !args[i + 1]) throw new Error(`Missing ${name}`); return resolve(args[i + 1]); };
const fork = arg('--fork'), theseus = arg('--theseus');
const write = args.includes('--write');
if (write === args.includes('--verify')) throw new Error('Choose exactly one of --write or --verify');
const git = (repo: string, ...a: string[]) => execFileSync('git', ['-C', repo, ...a], {encoding:'utf8'}).trim();
const hash = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const tools = [
  {name:'NIST fork', repository:'https://github.com/systemslibrarian/SP800-90B_EntropyAssessment', commit:git(fork,'rev-parse','HEAD'), executable:'cpp/ea_non_iid', binarySha256:hash(readFileSync(join(fork,'cpp/ea_non_iid')))},
  {name:'Theseus', repository:'https://github.com/KeyPair-Consulting/Theseus', commit:git(theseus,'rev-parse','HEAD'), executable:'src/non-iid-main', binarySha256:hash(readFileSync(join(theseus,'src/non-iid-main')))},
];
for (const repo of [fork, theseus]) if (git(repo, 'diff', '--name-only', 'HEAD')) throw new Error('Assessment tool tracked source must be clean');
const work = join(root,'.tool-cache/comparison'); mkdirSync(work,{recursive:true});
const out = join(root,'public/comparison'); if (write) mkdirSync(out,{recursive:true});
const reportPath = join(out,'results.json');
const previous = write ? null : validateComparison(JSON.parse(readFileSync(reportPath,'utf8')));
if (previous && tools.some((t,i) => t.commit !== previous.tools[i].commit)) throw new Error('Check out the exact recorded tool commits before verification');
const names = ['Most Common Value','Collision','Markov','Compression','T-Tuple','LRS','MultiMCW Prediction','Lag Prediction','MultiMMC Prediction','LZ78Y Prediction'];
const desc = ['Most Common Value','Collision Test (for bit strings only)','Markov Test (for bit strings only)','Compression Test (for bit strings only)','T-Tuple Test','LRS Test','Multi Most Common in Window Test','Lag Prediction Test','Multi Markov Model with Counting Test (MultiMMC)','LZ78Y Test'];
const cases = Array.from({length:6}, (_,i) => ({id:`model-${20261001+i}`, seed:20261001+i, kind:'model' as const}));
const runs = [];
for (const fixture of [...cases, {id:'counter-first-million-bits',seed:null,kind:'counter' as const}]) {
  const samples = fixture.seed === null ? unpackBits(new Uint8Array(readFileSync(join(root,'public/fixtures/counter-hash-sha256.bin')).subarray(0,125000)),1_000_000,'msb-first') : generateInmSamples(1_000_000,xoshiro128ss(fixture.seed));
  const inputSha256 = hash(samples), packed = packBits(samples);
  const file = `${fixture.id}.samples.bin`; writeFileSync(join(work,file), samples);
  const json = `${fixture.id}.nist.json`;
  const forkArgs = ['-i','-a','-o',json,file,'1'];
  const forkRun = spawnSync(join(fork,'cpp/ea_non_iid'),forkArgs,{cwd:work,encoding:'utf8',env:{...process.env,OMP_NUM_THREADS:'2'},maxBuffer:16*1024*1024});
  if (forkRun.status !== 0) throw new Error(`Fork refused ${fixture.id}: ${forkRun.stderr}`);
  const raw = readFileSync(join(work,json),'utf8');
  const data = JSON.parse(raw);
  if (data.sha256 !== inputSha256 || data.errorLevel !== 0) throw new Error('Fork input identity or assessment failure');
  const nistValues = desc.map((d,i) => {
    const entry = data.testCases.find((c: {testCaseDesc:string}) => c.testCaseDesc === d);
    return entry?.[i===4?'tTupleRes':i===5?'lrsRes':'hOriginal'] ?? null;
  });
  const theseusArgs = ['-r','-d','-s','-v',file];
  const th = spawnSync(join(theseus,'src/non-iid-main'),theseusArgs,{cwd:work,encoding:'utf8',env:{...process.env,OMP_NUM_THREADS:'2'},maxBuffer:16*1024*1024});
  if (th.status !== 0) throw new Error(`Theseus refused ${fixture.id}: ${th.stderr}`);
  const text = th.stdout + '\n' + th.stderr;
  const found = new Map([...text.matchAll(/^Literal (.+?) Estimate: min entropy = ([0-9.eE+-]+)$/gm)].map(m => [m[1].toLowerCase(), Number(m[2])]));
  const theseusValues = names.map(n => found.get(n.toLowerCase()) ?? null);
  const overall = [data.testCases.find((c:{testCaseDesc:string})=>c.testCaseDesc==='Overall')?.hAssessed,
    Number(text.match(/^Assessed min entropy = ([0-9.eE+-]+)$/m)?.[1])];
  const logs = [{file:json,sha256:hash(raw)}, {file:`${fixture.id}.theseus.txt`,sha256:hash(text)}];
  runs.push({...fixture,samples:samples.length,inputSha256,packedSha256:hash(packed),
    download:`comparison/${fixture.id}.bin`,commands:[`ea_non_iid ${forkArgs.join(' ')}`,`non-iid-main ${theseusArgs.join(' ')}`],
    logs,estimators:names.map((name,i)=>({name,values:[nistValues[i],theseusValues[i]]})),overall});
  if (write) { writeFileSync(join(out,`${fixture.id}.bin`),packed); writeFileSync(join(out,json),raw); writeFileSync(join(out,logs[1].file),text); }
  process.stdout.write(`${fixture.id}: fork ${overall[0]}, Theseus ${overall[1]}\n`);
}
const result = validateComparison({schemaVersion:1,date:new Date().toISOString(),sampleCount:1_000_000,bitsPerSymbol:1,
  platform:`${process.platform} ${process.arch}`, compiler:execFileSync('gcc',['--version'],{encoding:'utf8'}).split('\n')[0],
  tolerance:1e-9,tools,runs});
if (previous) {
  for (const [i,r] of result.runs.entries()) {
    const old = previous.runs[i];
    if (!old || old.id !== r.id || old.inputSha256 !== r.inputSha256) throw new Error(`Input mismatch: ${r.id}`);
    for (const [j,e] of r.estimators.entries()) for (let t=0;t<2;t++) {
      if (Math.abs(e.values[t]-old.estimators[j].values[t])>previous.tolerance) throw new Error(`Result mismatch: ${r.id} / ${e.name} / ${t}`);
    }
  }
  process.stdout.write('Verified input hashes and all 140 estimator values against recorded results.\n');
} else writeFileSync(reportPath,JSON.stringify(result,null,2)+'\n');
