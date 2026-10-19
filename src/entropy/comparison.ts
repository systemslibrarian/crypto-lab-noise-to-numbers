export interface ComparisonRun {
  id:string; seed:number|null; kind:'model'|'counter'; samples:number; inputSha256:string; packedSha256:string;
  download:string; commands:string[]; logs:{file:string;sha256:string}[];
  estimators:{name:string;values:number[]}[]; overall:number[];
}
export interface Comparison {
  schemaVersion:number; date:string; sampleCount:number; bitsPerSymbol:number; platform:string; compiler:string; tolerance:number;
  tools:{name:string;repository:string;commit:string;executable:string;binarySha256:string}[]; runs:ComparisonRun[];
}
const names = ['Most Common Value','Collision','Markov','Compression','T-Tuple','LRS','MultiMCW Prediction','Lag Prediction','MultiMMC Prediction','LZ78Y Prediction'];
export function validateComparison(value: unknown): Comparison {
  const d = value as Comparison;
  const sha = (x:unknown) => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
  if (!d || d.schemaVersion !== 1 || d.sampleCount !== 1_000_000 || d.bitsPerSymbol !== 1 || d.tolerance !== 1e-9 ||
    !Array.isArray(d.tools) || d.tools.length !== 2 || !Array.isArray(d.runs) || d.runs.length !== 7) throw new Error('Invalid comparison metadata');
  for (const t of d.tools) if (!/^[a-f0-9]{40}$/.test(t.commit) || !sha(t.binarySha256)) throw new Error('Missing tool provenance');
  const ids = new Set();
  for (const r of d.runs) {
    if (ids.has(r.id) || r.samples !== d.sampleCount || !sha(r.inputSha256) || !sha(r.packedSha256) ||
      !Array.isArray(r.estimators) || r.estimators.length !== 10 || !Array.isArray(r.overall) || r.overall.length !== 2 ||
      !/^comparison\/[a-z0-9-]+\.bin$/.test(r.download) || r.logs.length !== 2 || r.logs.some(l=>!sha(l.sha256))) throw new Error('Invalid comparison input or coverage');
    ids.add(r.id);
    r.estimators.forEach((e,i) => {
      if (e.name !== names[i] || !Array.isArray(e.values) || e.values.length !== 2 || e.values.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0||v>1)) throw new Error('Missing or invalid estimator result');
    });
    for (let i=0;i<2;i++) if (!Number.isFinite(r.overall[i]) || Math.abs(r.overall[i]-Math.min(...r.estimators.map(e=>e.values[i])))>1e-9) throw new Error('Overall result does not match estimator minimum');
  }
  if (d.runs.filter(r=>r.kind==='model').length!==6 || d.runs.filter(r=>r.kind==='counter').length!==1) throw new Error('Incomplete comparison cohorts');
  return d;
}
