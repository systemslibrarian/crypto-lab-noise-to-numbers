import { el, scroller } from './dom.ts';
import { validateComparison } from '../entropy/comparison.ts';
import comparisonJson from '../../public/comparison/results.json';

const HILL = 'https://www.untruth.org/~josh/sp80090b/';
function link(text:string, href:string): HTMLAnchorElement { return el('a',{href,target:'_blank',rel:'noopener noreferrer'},text); }

export function renderComparisonPanel(): HTMLElement {
  const root = el('section',{class:'card',id:'assessment-comparison','aria-labelledby':'comparison-title'});
  root.append(el('h3',{id:'comparison-title'},'Same bytes, two assessment tools'));
  let data;
  try { data = validateComparison(comparisonJson); }
  catch { root.append(el('p',{},'Comparison evidence failed validation. No comparison figures are shown.')); return root; }
  root.append(el('p',{},'Select one of seven published synthetic inputs. These recorded native runs use the same 1,000,000 one-bit samples in each tool. This comparison has its own selection; it is not an assessment of your uploaded file.'),
    el('p',{class:'note'},'Public, reproducible data — never secret. Six inputs simulate the same circuit under different published seeds. The seventh is the first million bits of the public SHA-256 counter fixture, unpacked MSB-first. All results below are bits per one-bit sample.'),
    el('label',{for:'comparison-input'},'Comparison input'));
  const choice = el('select',{id:'comparison-input'},...data.runs.map(r=>el('option',{value:r.id},r.kind==='model'?`Simulated circuit · seed ${r.seed}`:'Predictable SHA-256 counter · first million bits')));
  const result = el('div',{id:'comparison-result','aria-live':'polite'});
  root.append(choice,result);
  const paint = () => {
    const r = data.runs.find(x=>x.id===choice.value)!;
    const discrepancies = r.estimators.filter(e=>Math.abs(e.values[0]-e.values[1])>data.tolerance);
    const table = el('table',{},el('caption',{},'Pinned native results; agreement tolerance 10⁻⁹ bits/sample. A difference is evidence to investigate, not a verdict about which tool is right.'),
      el('thead',{},el('tr',{},...['Estimator','NIST fork','Theseus','Absolute difference'].map(s=>el('th',{scope:'col'},s)))),
      el('tbody',{},...r.estimators.map(e=>el('tr',{},el('th',{scope:'row'},e.name),...e.values.map(v=>el('td',{class:'num'},v.toFixed(9))),el('td',{class:'num'},Math.abs(e.values[0]-e.values[1]).toExponential(2))))));
    result.replaceChildren(el('p',{class:'comparison-verdict'},`${10-discrepancies.length}/10 estimators agree within tolerance. Overall minimum: NIST fork ${r.overall[0].toFixed(9)}; Theseus ${r.overall[1].toFixed(9)} bits/sample.`),
      scroller('Two-tool estimator comparison',table),
      el('p',{},link('Download packed input',r.download),' · ',...r.logs.flatMap((l,i)=>[link(i===0?'Fork JSON report':'Theseus output',`comparison/${l.file}`),' · ']),link('Full provenance and results','comparison/results.json')),
      el('p',{class:'note comparison-hash'},`SHA-256 of assessed one-sample-per-byte input: ${r.inputSha256}`));
  };
  choice.addEventListener('change',paint); paint();

  const cohort = data.runs.filter(r=>r.kind==='model');
  const values = cohort.map(r=>r.overall[0]);
  root.append(el('h3',{},'One unchanged model, six different runs'),
    el('p',{},`The NIST-fork minimum ranges from ${Math.min(...values).toFixed(6)} to ${Math.max(...values).toFixed(6)} bits/sample across these six seeds. Theseus results are shown alongside each run above. This is an observed range, not a confidence interval, an acceptance threshold, or a hardware entropy claim.`),
    el('p',{},'Repetition makes variability visible. Six synthetic runs do not calibrate a 99% confidence statement. The estimator minimum also does not remove every modeling assumption. A reproducible estimate and a justified source model are different pieces of evidence.'));

  const scenarios = [
    {name:'Biased coin, same process each time',answer:'IID can be biased. In this assumed model, each sample is independent and has P(1)=0.53; bias alone does not force the non-IID track.'},
    {name:'Repeat the last bit 85% of the time',answer:'Not independent. The long-run histogram can remain 53/47 while the preceding bit becomes highly predictive. A stable histogram cannot establish IID.'},
    {name:'Fresh draws, but bias changes over time',answer:'Not identically distributed. Independent draws are insufficient if their probability distribution drifts. Source conditions and operating environment matter.'},
    {name:'Known 010101… sequence',answer:'Completely predictable. A 50/50 histogram provides no entropy guarantee; the public rule determines every next sample.'},
  ];
  root.append(el('h3',{},'Would you claim IID?'),el('p',{},'Choose a source description and decide before revealing the explanation. These are specified models, not conclusions inferred from a finite statistical pass.'));
  const scenario = el('select',{id:'iid-scenario'},...scenarios.map((s,i)=>el('option',{value:String(i)},s.name)));
  const reveal = el('button',{type:'button',id:'iid-reveal'},'Explain this assumption');
  const explanation = el('p',{id:'iid-answer',role:'status','aria-live':'polite'});
  root.append(el('label',{for:'iid-scenario'},'Source model'),scenario,reveal,explanation);
  scenario.addEventListener('change',()=>explanation.replaceChildren());
  reveal.addEventListener('click',()=>{ explanation.textContent=scenarios[+scenario.value].answer; });
  const provenance = el('details',{},el('summary',{},'Versions, reproduction, and credit'));
  provenance.append(el('p',{},`Recorded ${data.date.slice(0,10)} on ${data.platform}. Each tool was run from a clean source checkout. Floating-point differences within 10⁻⁹ are reported as agreement, not bit-identical output.`));
  for (const t of data.tools) provenance.append(el('p',{class:'comparison-hash'},link(t.name,`${t.repository}/tree/${t.commit}`),` · ${t.commit}`));
  provenance.append(el('p',{},'Reproduce with scripts/compare-assessments.ts --verify using the commits above. Downloadable reports preserve the native output; the full JSON records commands, input hashes and binary hashes.'),
    el('p',{},'Credit: ',el('strong',{},'Joshua E. Hill'),' and ',link('Theseus / KeyPair Consulting','https://github.com/KeyPair-Consulting/Theseus'),
      ' supply the second assessment implementation. Hill’s ',link('The IID Assumption and YOU!',HILL+'The%20IID%20Assumption%20and%20YOU%20D14.pdf'),
      ' (ICMC 2019, D14) informs the assumption exercise. His ',link('SP 800-90B Refinements',HILL+'90B%20Extravaganza%2020200921.pdf'),
      ' (ICMC 2020, version 20200921, slides 14–26) motivates examining assessment variability and confidence assumptions.'),
    el('p',{},'The fixtures, comparison harness, and interaction are original Crypto Lab work. No slide graphics or numerical tables were copied. Theseus source and binaries are not redistributed. Neither tool agreement nor attribution implies Hill’s review, endorsement, or NIST validation.'),
    el('p',{},'Standard: ',link('NIST SP 800-90B','https://csrc.nist.gov/pubs/sp/800/90/b/final'),'. Proposals discussed in the presentations are identified as analysis rather than adopted requirements.'));
  root.append(el('p',{class:'note'},'With credit to Joshua E. Hill for the IID and assessment-stability lessons, and Hill / KeyPair Consulting for Theseus. Source links and exact versions follow.'),provenance);
  return root;
}
