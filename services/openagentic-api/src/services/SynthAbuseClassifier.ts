/**
 * SynthAbuseClassifier
 *
 * Static keyword + regex classifier that flags synth requests matching our
 * prohibited categories. Runs at two gates:
 *   - pre-synthesis on raw intent (cheap early-exit)
 *   - post-synthesis on generated code (catches LLM-laundered intent)
 *
 * Any positive match forces risk_level=critical, which routes the request
 * to the refusal path in SynthService rather than execution.
 *
 * The patterns are deliberately narrow to minimize false positives on
 * legitimate DevOps/security-research phrasing. When ambiguous (e.g.
 * "stress test my service"), the code-pattern sibling gate catches the
 * abuse payload even if the intent text slips through.
 */

export type AbuseCategory =
  | 'adult'
  | 'piracy'
  | 'crypto'
  | 'exfil'
  | 'scrape'
  | 'dos';

export type AbuseConfidence = 'low' | 'medium' | 'high';

export interface ClassifyInput {
  intent: string;
  code?: string;
}

export interface ClassifyResult {
  category: AbuseCategory | null;
  confidence: AbuseConfidence;
  matchedPatterns: string[];
}

interface PatternSet {
  category: AbuseCategory;
  intent: RegExp[];
  /** Code-side patterns — scanned only when `code` is provided. */
  code: RegExp[];
  /** AND-composed code patterns — every regex in the group must match
   *  somewhere in the code for the group to trigger (handles "high thread
   *  count AND http calls" where the two tokens appear in any order). */
  codeAllOf?: RegExp[][];
}

// Adult / sexual content. `nsfw` alone is too common in non-abuse contexts
// (issue labels, comment tags) — require it next to scrape/download verbs.
const ADULT: PatternSet = {
  category: 'adult',
  intent: [
    /\b(pornhub|xvideos|xhamster|redtube|youporn|spankbang|rule34)\b/i,
    /\bporn(\s*(videos?|content|sites?|images?))?\b/i,
    /\b(xxx|x-rated)\s+(content|videos?|images?)\b/i,
    /\b(download|scrape|collect|find)\s+(nsfw|adult|sexual)\s+(content|images?|videos?)\b/i,
  ],
  code: [
    /\bhttps?:\/\/[^\s'"]*(pornhub|xvideos|xhamster|redtube|youporn)[^\s'"]*/i,
  ],
};

// Piracy / warez / DRM bypass / key-gen.
const PIRACY: PatternSet = {
  category: 'piracy',
  intent: [
    /\b(keygen|key[-\s]?gen(erator)?|crack(ed|ing)?)\b.*\b(license|photoshop|adobe|windows|office)\b/i,
    /\bwarez\b/i,
    /\b(bypass|remove|strip)\s+(drm|copy[-\s]?protection|activation)\b/i,
    /\bcrack\s+the\s+drm\b/i,
    /\bgenerate\s+(a\s+)?pirated\s+.*key\b/i,
    /\bpirated?\s+(software|license|key|copy)\b/i,
    /\bdownload\s+(from\s+)?warez\b/i,
  ],
  code: [/\b(keygen|drm_bypass|license_crack)\b/i],
};

// Coin mining, wallet drain, phishing for keys.
const CRYPTO: PatternSet = {
  category: 'crypto',
  intent: [
    /\b(bitcoin|monero|ethereum|eth|btc|xmr)\s+miner\b/i,
    /\b(bitcoin|monero|ethereum|crypto)\s+mining\b/i,
    /\b(start|setup|run|deploy|install|hidden)\b.*\b(miner|mining)\b/i,
    /\bmin(e|ing)\s+(monero|bitcoin|eth|crypto)\b/i,
    /\bdrain\s+(the\s+)?(wallet|metamask|phantom)\b/i,
    /\bseed\s*phrase\s+(extract|steal|phish)\b/i,
  ],
  code: [
    /\b(xmrig|cpuminer|ccminer|nanominer|t-rex|phoenixminer|nbminer)\b/i,
    /\bstratum\+tcp:\/\//i,
  ],
};

// Data exfiltration to personal / external endpoints, IMDS abuse.
// We combine (data-source) + (personal-destination) — either alone is common.
const EXFIL: PatternSet = {
  category: 'exfil',
  intent: [
    /\b(upload|ship|send|exfil(trate)?|leak|copy)\b.*\b(to|into)\b\s+(my\s+)?(personal\s+)?(gmail|protonmail|pastebin|webhook\.site|discord|telegram|transfer\.sh|0x0\.st)\b/i,
    /\b(upload|copy|ship)\s+.*\b(customer|user|employee|hr|payroll|ssn|secrets?|credentials?|database|db|env\s*vars?)\b.*\b(to\s+my|personal|external|my\s+own)\b/i,
    /\b(copy|dump|send)\s+.*\/etc\/(passwd|shadow|kubernetes|rancher)\b.*\bto\b/i,
    /\bexfiltrate\b/i,
  ],
  code: [
    /\b169\.254\.169\.254\b/, // IMDS (AWS/Azure/GCP metadata)
    /\bmetadata\.google\.internal\b/i,
    /\bhttps?:\/\/webhook\.site\//i,
    /\bhttps?:\/\/(pastebin|transfer\.sh|0x0\.st|gist\.github\.com)\//i,
    /\brequests\.post\s*\(\s*['"]https?:\/\/[^'"]*(webhook\.site|ngrok|loca\.lt)/i,
  ],
};

// Mass scraping. We look for volume/rate hints — "scrape" alone is fine.
const SCRAPE: PatternSet = {
  category: 'scrape',
  intent: [
    /\bmass[-\s]scrape\b/i,
    /\bscrape\s+every\s+(listing|page|user|product)\b/i,
    /\bscrape\s+\d{3,}[,\s]?\d*\+?\s+(pages?|records?|products?|listings?|rows?)\s+(per\s+(hour|minute|second|day))?\b/i,
    /\bscrape\s+\d+[kmb]\s+(pages?|records?|products?|listings?|rows?)\b/i,
    /\bharvest\s+(all\s+)?(emails?|phone\s*numbers?|credentials?)\b/i,
  ],
  code: [
    /for\s+\w+\s+in\s+range\(\s*[1-9]\d{5,}\s*\)\s*:[\s\S]{0,200}\brequests\.(get|post)/i,
  ],
};

// DoS / flood / reflection / amplification.
const DOS: PatternSet = {
  category: 'dos',
  intent: [
    /\b(d?dos|denial[-\s]of[-\s]service)\b/i,
    /\bflood\s+[\w.-]+\.(com|net|org|io|dev|ai|gov)\b.*\b(requests?|packets?|traffic)\b/i,
    /\bflood\s+[\w.-]+\.(com|net|org|io|dev|ai|gov)\s+with\b/i,
    /\b(syn|udp|icmp|slowloris|slow[-\s]loris|http)\s+flood\b/i,
    /\b(dns|ntp|memcached)\s+amplif(ication|y)\b/i,
    /\bamplification\s+attack\b/i,
    /\breflection\s+attack\b/i,
  ],
  code: [
    // Tight-loop 1M+ iterations calling requests.get/post = flood.
    /for\s+_?\s+in\s+range\(\s*[1-9]\d{5,}\s*\)\s*:[\s\S]{0,200}\brequests\.(get|post)/i,
  ],
  /** AND-composed patterns — both must match for the category to trigger.
   *  Used when a single regex can't express "high thread count + http calls"
   *  because the two tokens may appear in arbitrary order. */
  codeAllOf: [
    [
      /ThreadPoolExecutor\s*\(\s*max_workers\s*=\s*(\d{3,})\s*\)/i,
      /\brequests\.(get|post)\s*\(/i,
    ],
  ],
};

const ALL_SETS: PatternSet[] = [ADULT, PIRACY, CRYPTO, EXFIL, SCRAPE, DOS];

export class SynthAbuseClassifier {
  /**
   * Classify an input. Returns the first category that matches (highest-
   * priority order: adult, piracy, crypto, exfil, scrape, dos).
   */
  classify(input: ClassifyInput): ClassifyResult {
    const intent = (input.intent || '').trim();
    const code = (input.code || '').trim();
    if (!intent && !code) {
      return { category: null, confidence: 'low', matchedPatterns: [] };
    }

    for (const set of ALL_SETS) {
      const matched: string[] = [];
      for (const re of set.intent) {
        const m = intent.match(re);
        if (m) matched.push(m[0]);
      }
      if (code) {
        for (const re of set.code) {
          const m = code.match(re);
          if (m) matched.push(m[0]);
        }
        for (const group of set.codeAllOf ?? []) {
          const groupMatches: string[] = [];
          for (const re of group) {
            const m = code.match(re);
            if (!m) break;
            groupMatches.push(m[0]);
          }
          if (groupMatches.length === group.length) {
            matched.push(...groupMatches);
          }
        }
      }
      if (matched.length > 0) {
        const confidence: AbuseConfidence =
          matched.length >= 2 ? 'high' : 'medium';
        return { category: set.category, confidence, matchedPatterns: matched };
      }
    }

    return { category: null, confidence: 'low', matchedPatterns: [] };
  }

  /**
   * Convenience for SynthService — returns 'critical' when any abuse is
   * detected so the service can skip the normal LLM-supplied risk_level.
   */
  forcedRiskLevel(input: ClassifyInput): 'critical' | null {
    return this.classify(input).category ? 'critical' : null;
  }
}
