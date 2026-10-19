import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validateComparison } from './comparison.ts';
import { unpackBits } from './encoding.ts';
import data from '../../public/comparison/results.json';

it('published inputs and original tool reports support every comparison value', () => {
  const d = validateComparison(data);
  const sha = (b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
  for (const r of d.runs) {
    const packed = readFileSync(`public/${r.download}`);
    expect(sha(packed)).toBe(r.packedSha256);
    expect(sha(unpackBits(packed,r.samples,'msb-first'))).toBe(r.inputSha256);
    for (const l of r.logs) expect(sha(readFileSync(`public/comparison/${l.file}`))).toBe(l.sha256);
    const fork = JSON.parse(readFileSync(`public/comparison/${r.logs[0].file}`,'utf8'));
    expect(fork.sha256).toBe(r.inputSha256);
    const theseus = readFileSync(`public/comparison/${r.logs[1].file}`,'utf8');
    const actual = [...theseus.matchAll(/^Literal .+? Estimate: min entropy = ([0-9.eE+-]+)$/gm)].map(m=>Number(m[1]));
    expect(actual).toHaveLength(10);
    const forkValues = fork.testCases.filter((c:{testCaseDesc:string})=>c.testCaseDesc!=='Overall').map((c:Record<string,number>)=>c.hOriginal??c.tTupleRes??c.lrsRes);
    expect(r.estimators.map(e=>e.values[0])).toEqual(forkValues);
    expect(r.estimators.map(e=>e.values[1])).toEqual(actual);
  }
});
it('missing estimators, corrupted provenance and misleading minima fail closed', () => {
  for (const damage of [
    (d:typeof data)=>{d.runs[0].estimators.pop();},
    (d:typeof data)=>{d.runs[0].estimators[0].values[0]=NaN;},
    (d:typeof data)=>{d.tools[0].commit='unknown';},
    (d:typeof data)=>{d.runs[0].overall[0]=1;},
    (d:typeof data)=>{d.runs[0].samples=999999;},
  ]) {const copy=structuredClone(data);damage(copy);expect(()=>validateComparison(copy)).toThrow();}
});
