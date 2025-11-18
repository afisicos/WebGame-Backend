// src/scoring.ts
export function computeScoreForPair(source: string, answer: string, sourceInfo: any, answerInfo: any) {
    // normalizaciones simples:
    const norm = (s: any) => (s ?? "").toString().trim().toLowerCase();
    const s1 = norm(source);
    const s2 = norm(answer);
  
    let points = 0;
    const checks = {
      startsWith: false,
      endsWith: false,
      sameLength: false,
      sameCountry: false,
      sharedLanguage: false,
      populationSimilar: false,
      foundedSameCentury: false
    };
  
    // a1 starts with
    if (s2[0] && s1[0] && s2[0] === s1[0]) { checks.startsWith = true; points += 1; }
    // a2 ends with
    if (s2.slice(-1) && s1.slice(-1) && s2.slice(-1) === s1.slice(-1)) { checks.endsWith = true; points += 1; }
    // b same length
    if (s2.replace(/\s+/g, "").length === s1.replace(/\s+/g, "").length) { checks.sameLength = true; points += 1; }
  
    // c same country
    const countryA = sourceInfo?.country?.toString().toLowerCase?.() ?? null;
    const countryB = answerInfo?.country?.toString().toLowerCase?.() ?? null;
    if (countryA && countryB && countryA === countryB) { checks.sameCountry = true; points += 1; }
  
    // d shared language
    const langsA = (sourceInfo?.languages ?? []).map((l: string) => l.toLowerCase());
    const langsB = (answerInfo?.languages ?? []).map((l: string) => l.toLowerCase());
    if (langsA.length && langsB.length && langsA.some((la: string) => langsB.includes(la))) {
      checks.sharedLanguage = true; points += 1;
    }
  
    // e population similar within 20% => 2 points
    const popA = Number(sourceInfo?.population) || null;
    const popB = Number(answerInfo?.population) || null;
    if (popA && popB) {
      const ratio = Math.abs(popA - popB) / Math.max(popA, popB);
      if (ratio <= 0.2) { checks.populationSimilar = true; points += 2; }
    }
  
    // f same century founded => 3 points
    const fA = Number(sourceInfo?.foundedYear) || null;
    const fB = Number(answerInfo?.foundedYear) || null;
    if (fA && fB) {
      const cA = Math.floor((fA - 1) / 100) + 1; // century number
      const cB = Math.floor((fB - 1) / 100) + 1;
      if (cA === cB) { checks.foundedSameCentury = true; points += 3; }
    }
  
    return { points, checks, answerInfo };
  }
  