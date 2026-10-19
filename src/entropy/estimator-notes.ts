/** Scope clarifications informed by Hill, SP 800-90B Refinements (20200921),
 * slides 16–23. Historical report annotations remain intact in the manifest. */
export function estimatorNote(name:string, original:string): string {
  const notes:Record<string,string> = {
    Compression: 'Uses recurrence-distance statistics and a reference model to estimate entropy. Its confidence calculation is not assumption-free; dependence can affect its interpretation. Defined for binary input.',
    'T-Tuple': 'Uses the most frequent repeated tuple. Overlapping tuples and taking a maximum complicate the confidence calculation; using the non-IID track does not remove these assumptions.',
    LRS: 'Uses repeated substrings and collision statistics. Independence assumptions in the statistical derivation need care for dependent sources; an observed long repeat is evidence, not a universal entropy bound.',
  };
  return notes[name] ?? original;
}
