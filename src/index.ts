// ---------------------------------------------------------------------------
// Env — bindings declared in wrangler.toml
// ---------------------------------------------------------------------------

export interface Env {
  RATE_LIMITER: DurableObjectNamespace;
}

// ---------------------------------------------------------------------------
// RateLimiter — Durable Object
//
// One instance per client IP. Stores request count + window reset time in
// SQLite (Cloudflare's DO storage). Strongly consistent across all edge
// locations — no per-isolate drift.
//
// Limit: 5 requests per minute.
// ---------------------------------------------------------------------------

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 1000; // 1 minute

export class RateLimiter implements DurableObject {
  private storage: DurableObjectStorage;

  constructor(state: DurableObjectState) {
    this.storage = state.storage;
  }

  async fetch(_request: Request): Promise<Response> {
    const now = Date.now();

    const [count, resetTime] = await Promise.all([
      this.storage.get<number>("count"),
      this.storage.get<number>("resetTime"),
    ]);

    // If no window exists yet, or the window has expired, start a fresh one
    if (resetTime === undefined || now >= resetTime) {
      await this.storage.put("count", 1);
      await this.storage.put("resetTime", now + RATE_WINDOW_MS);
      return Response.json({ allowed: true });
    }

    if ((count ?? 0) >= RATE_LIMIT) {
      const retryAfter = Math.ceil((resetTime - now) / 1000);
      return Response.json({ allowed: false, retryAfter });
    }

    await this.storage.put("count", (count ?? 0) + 1);
    return Response.json({ allowed: true });
  }
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: { code: status, message } }, status);
}

// ---------------------------------------------------------------------------
// Proper noun preservation
//
// Extracts tokens that should survive translation unchanged (POKéMON, DNA,
// all-caps acronyms, Pokémon proper names like "MEW", "PIKACHU", etc.),
// replaces them with numeric placeholders, then restores them afterward.
// This prevents word-boundary rules from partially mangling them.
// ---------------------------------------------------------------------------

const PROPER_NOUN_PATTERNS = [
  /POK[Éé]MON/gi,        // POKéMON / POKEMON
  /\bDNA\b/g,
  /\bRNA\b/g,
  /\b[A-Z]{2,}\b/g,      // all-caps acronyms / Pokémon names in caps (MEW, HP, etc.)
];

function preserveProperNouns(text: string): { processed: string; tokens: string[] } {
  const tokens: string[] = [];
  let processed = text;

  for (const pattern of PROPER_NOUN_PATTERNS) {
    processed = processed.replace(pattern, (match) => {
      // Avoid duplicating already-stored tokens
      let idx = tokens.indexOf(match);
      if (idx === -1) {
        idx = tokens.length;
        tokens.push(match);
      }
      return `__PN${idx}__`;
    });
  }

  return { processed, tokens };
}

function restoreProperNouns(text: string, tokens: string[]): string {
  return text.replace(/__PN(\d+)__/g, (_, i) => tokens[parseInt(i, 10)] ?? "");
}

// ---------------------------------------------------------------------------
// Yoda translator
//
// Strategy:
//   1. Preserve proper nouns.
//   2. Apply word-level replacements.
//   3. Rearrange clause structure per sentence:
//      a. "Capable of X, subject is" pattern
//      b. Passive voice: "Subject was verbed by agent" → "By agent, verbed subject was"
//      c. "When X, Y" → "Y, when X"
//      d. General clause flip on conjunctions/commas
//      e. Subject-verb-object inversion for simple sentences
//   4. Append a Yoda filler phrase.
//   5. Restore proper nouns.
// ---------------------------------------------------------------------------

const YODA_WORD_MAP: Array<[RegExp, string]> = [
  // Pokemon / scientific vocabulary
  [/\bcapable of\b/gi, "able to"],
  [/\binstantly\b/gi, "at once"],
  [/\btransform(?:s|ed|ing)?\b/gi, "change"],
  [/\bduplicate\b/gi, "copy"],
  [/\bscientist\b/gi, "one of great knowledge"],
  [/\bexperiments?\b/gi, "trials"],
  [/\bgenetic code\b/gi, "life essence"],
  [/\bgenetic\b/gi, "life"],
  [/\belectricity\b/gi, "spark energy"],
  [/\bgather(?:s|ed|ing)?\b/gi, "come together"],
  [/\bhorrific\b/gi, "terrible"],
  [/\bcreatures?\b/gi, "beings"],
  [/\bcopying\b/gi, "mimicking"],
  [/\bcopies\b/gi, "mimics"],
  [/\bcopy\b/gi, "mimic"],
  [/\blightning storms?\b/gi, "sky fire tempests"],
  [/\blightning\b/gi, "sky fire"],
  [/\bstorms?\b/gi, "great disturbances"],
  [/\battack(?:s|ed|ing)?\b/gi, "strike"],
  [/\bdefend(?:s|ed|ing)?\b/gi, "protect"],
  [/\bdestroy(?:s|ed|ing)?\b/gi, "obliterate"],
  [/\bseveral\b/gi, "many"],
  [/\bcause(?:s|d)?\b/gi, "bring about"],
  [/\baccumulat(?:es?|ed|ing)\b/gi, "grow"],
  [/\bevolve(?:s|d|ing)?\b/gi, "change form"],
  [/\bwild\b/gi, "untamed"],
  [/\babilit(?:y|ies)\b/gi, "gift"],
  [/\bpower(?:s|ful)?\b/gi, "strength"],
  [/\brake\b/gi, "seldom found"],
  [/\bancient\b/gi, "of old times"],
  [/\bcreated?\b/gi, "made"],
  [/\bsplicing\b/gi, "fusing"],
  [/\bsplice(?:s|d)?\b/gi, "fuse"],
  [/\bengineering\b/gi, "crafting"],
  [/\bexperiment(?:s|ed|ing)?\b/gi, "trial"],
  [/\benerg(?:y|ies)\b/gi, "force"],
  [/\bspecies\b/gi, "kind"],
  [/\bevolut(?:ion|ionary)\b/gi, "change of form"],
  [/\bflame(?:s|thrower)?\b/gi, "fire breath"],
  [/\bwings?\b/gi, "great limbs"],
  [/\bclaws?\b/gi, "talons"],
  [/\bfang(?:s)?\b/gi, "sharp teeth"],
  [/\btail(?:s)?\b/gi, "appendage"],
  [/\bshell\b/gi, "hard casing"],
  [/\bpretend(?:s|ed|ing)?\b/gi, "feign"],
  [/\brelease(?:s|d|ing)?\b/gi, "unleash"],
  [/\babsorb(?:s|ed|ing)?\b/gi, "draw in"],
  [/\bemit(?:s|ted|ting)?\b/gi, "release"],
  [/\bgenerat(?:es?|ed|ing)\b/gi, "produce"],
  // General vocabulary (original + expanded)
  [/\bvery\b/gi, "most"],
  [/\breally\b/gi, "truly"],
  [/\bgreat\b/gi, "powerful"],
  [/\bgood\b/gi, "worthy"],
  [/\bbad\b/gi, "unworthy"],
  [/\bfriend\b/gi, "ally"],
  [/\benemy's\b/gi, "foe's"],
  [/\benemy\b/gi, "foe"],
  [/\bwill\b/gi, "shall"],
  [/\bneed\b/gi, "must"],
  [/\bwant\b/gi, "seek"],
  [/\bknow\b/gi, "sense"],
  [/\bthink\b/gi, "believe"],
  [/\bsee\b/gi, "perceive"],
  [/\bgo\b/gi, "venture"],
  [/\bcome\b/gi, "arrive"],
  [/\bhelp\b/gi, "aid"],
  [/\bstrong\b/gi, "powerful"],
  [/\bweak\b/gi, "feeble"],
  [/\blearn\b/gi, "study"],
  [/\bteach\b/gi, "instruct"],
  [/\bfear\b/gi, "afraid be"],
  [/\bhappy\b/gi, "at peace"],
  [/\bsad\b/gi, "troubled"],
  [/\bquick\b/gi, "swift"],
  [/\bslow\b/gi, "patient"],
];

const YODA_FILLERS = [
  ", hmm.",
  ", yes.",
  ", I say.",
  ". The Force is with you.",
  ". Much to learn, you still have.",
  ", young one.",
  ". Strong with the Force, you are.",
  ". Powerful, the ways of nature are.",
  ", sense this I do.",
  ". Curious, this is.",
];

function rearrangeToYoda(sentence: string): string {
  const trailingPunct = sentence.match(/[.!?]+$/)?.[0] ?? "";
  const core = sentence.replace(/[.!?]+$/, "").trim();

  if (!core) return sentence;

  // Pattern: "Subject is/are capable of/able to <gerund phrase>"
  // → "Of/To <gerund phrase>, capable/able <subject> is"
  const capablePattern = /^(.+?)\s+(?:is|are)\s+(capable of|able to)\s+(.+)$/i;
  const capableMatch = core.match(capablePattern);
  if (capableMatch) {
    const [, subject, qualifier, gerund] = capableMatch;
    const verb = /\bare\b/i.test(capableMatch[0]) ? "are" : "is";
    return (
      qualifier.charAt(0).toUpperCase() +
      qualifier.slice(1) +
      " " +
      gerund +
      ", " +
      subject.toLowerCase() +
      " " +
      verb +
      trailingPunct
    );
  }

  // Pattern: passive voice "Subject was/were verbed by agent"
  // → "By agent, verbed subject was"
  const passivePattern = /^(.+?)\s+(was|were)\s+(.+?)\s+by\s+(.+)$/i;
  const passiveMatch = core.match(passivePattern);
  if (passiveMatch) {
    const [, subject, auxVerb, pastParticiple, agent] = passiveMatch;
    return (
      "By " +
      agent +
      ", " +
      pastParticiple +
      " " +
      subject.toLowerCase() +
      " " +
      auxVerb.toLowerCase() +
      trailingPunct
    );
  }

  // Pattern: "When X, Y" → "Y, when X"
  const whenPattern = /^when\s+(.+?),\s+(.+)$/i;
  const whenMatch = core.match(whenPattern);
  if (whenMatch) {
    const [, condition, consequence] = whenMatch;
    return (
      consequence.charAt(0).toUpperCase() +
      consequence.slice(1) +
      ", when " +
      condition.toLowerCase() +
      trailingPunct
    );
  }

  // General clause splits
  const splitPatterns = [
    /^(.+?),\s+(.+)$/,
    /^(.+?)\s+because\s+(.+)$/i,
    /^(.+?)\s+but\s+(.+)$/i,
    /^(.+?)\s+and\s+(.+)$/i,
    /^(.+?)\s+so\s+(.+)$/i,
    /^(.+?)\s+that\s+(.+)$/i,
    /^(.+?)\s+after\s+(.+)$/i,
  ];

  for (const pattern of splitPatterns) {
    const m = core.match(pattern);
    if (m) {
      const [, first, second] = m;
      const rearranged =
        second.charAt(0).toUpperCase() + second.slice(1) + ", " + first.toLowerCase();
      return rearranged + trailingPunct;
    }
  }

  // Simple subject-verb-object inversion
  const subjectVerbPattern = /^(I|You|He|She|We|They|It)\s+(\w+)\s+(.+)$/i;
  const sv = core.match(subjectVerbPattern);
  if (sv) {
    const [, subject, verb, rest] = sv;
    return (
      rest.charAt(0).toUpperCase() +
      rest.slice(1) +
      ", " +
      subject.toLowerCase() +
      " " +
      verb.toLowerCase() +
      trailingPunct
    );
  }

  return sentence;
}

function translateToYoda(text: string): string {
  const { processed, tokens } = preserveProperNouns(text);

  let result = processed;
  for (const [pattern, replacement] of YODA_WORD_MAP) {
    if (typeof replacement === "string") {
      result = result.replace(pattern, (match) => {
        const rep = replacement as string;
        if (match[0] === match[0].toUpperCase() && match[0] !== match[0].toLowerCase()) {
          return rep.charAt(0).toUpperCase() + rep.slice(1);
        }
        return rep;
      });
    } else {
      result = result.replace(pattern, replacement as (m: string) => string);
    }
  }

  const sentences = result.match(/[^.!?]+[.!?]*/g) ?? [result];
  const rearranged = sentences.map((s) => rearrangeToYoda(s.trim()));

  const filler =
    YODA_FILLERS[Math.floor(Math.abs(Math.sin(text.length * 13)) * YODA_FILLERS.length)];
  const last = rearranged[rearranged.length - 1];
  rearranged[rearranged.length - 1] = last.replace(/[.!?]*$/, "") + filler;

  const joined = rearranged.join(" ").trim();
  return restoreProperNouns(joined, tokens);
}

// ---------------------------------------------------------------------------
// Shakespeare translator
//
// Strategy:
//   1. Preserve proper nouns.
//   2. Apply phrase-level replacements first (multi-word).
//   3. Apply word-level pronoun, verb, and vocabulary replacements.
//   4. Prepend an Elizabethan flourish.
//   5. Restore proper nouns.
// ---------------------------------------------------------------------------

const SHAKESPEARE_MAP: Array<[RegExp, string]> = [
  // Multi-word phrase replacements (must come before single-word rules)
  [/\bafter years of\b/gi, "after many a year of"],
  [/\bgenetic code\b/gi, "very essence"],
  [/\bgene splicing\b/gi, "alchemical fusion"],
  [/\bDNA engineering\b/gi, "transmutation of the life essence"],
  [/\blightning storms?\b/gi, "great tempests of thunder"],
  [/\bthank you\b/gi, "gramercy"],
  [/\byou're\b/gi, "thou art"],
  [/\byou've\b/gi, "thou hast"],
  [/\byou'll\b/gi, "thou shalt"],
  [/\byou'd\b/gi, "thou wouldst"],
  [/\bI'm\b/gi, "I am"],
  [/\bI've\b/gi, "I hast"],
  [/\bI'll\b/gi, "I shall"],
  [/\bI'd\b/gi, "I wouldst"],
  [/\bit's\b/gi, "it is"],
  [/\bhe's\b/gi, "he is"],
  [/\bshe's\b/gi, "she is"],
  [/\bwe're\b/gi, "we art"],
  [/\bwe've\b/gi, "we hast"],
  [/\bthey're\b/gi, "they art"],
  [/\bthey've\b/gi, "they hast"],
  [/\bdon't\b/gi, "dost not"],
  [/\bdoesn't\b/gi, "doth not"],
  [/\bdidn't\b/gi, "didst not"],
  [/\bwon't\b/gi, "shall not"],
  [/\bwouldn't\b/gi, "wouldst not"],
  [/\bshouldn't\b/gi, "shouldst not"],
  [/\bcouldn't\b/gi, "couldst not"],
  [/\bcan't\b/gi, "canst not"],
  [/\bhaven't\b/gi, "hast not"],
  [/\bhasn't\b/gi, "hath not"],
  [/\bwasn't\b/gi, "wast not"],
  [/\bweren't\b/gi, "wert not"],
  [/\bisn't\b/gi, "is not"],
  [/\baren't\b/gi, "art not"],
  // Pronouns
  [/\byou\b/gi, "thou"],
  [/\byour\b/gi, "thy"],
  [/\byours\b/gi, "thine"],
  [/\byourself\b/gi, "thyself"],
  // Verb forms
  [/\bwere\b/gi, "wert"],
  [/\bwas\b/gi, "wast"],
  [/\bare\b/gi, "art"],
  [/\bhave\b/gi, "hast"],
  [/\bhas\b/gi, "hath"],
  [/\bhad\b/gi, "hadst"],
  [/\bdo\b/gi, "dost"],
  [/\bdoes\b/gi, "doth"],
  [/\bdid\b/gi, "didst"],
  [/\bwill\b/gi, "shall"],
  [/\bwould\b/gi, "wouldst"],
  [/\bshould\b/gi, "shouldst"],
  [/\bcould\b/gi, "couldst"],
  [/\bmight\b/gi, "mayst"],
  [/\bcan\b/gi, "canst"],
  [/\bknow\b/gi, "knowest"],
  [/\bgo\b/gi, "dost go"],
  [/\bsee\b/gi, "dost see"],
  [/\bsay\b/gi, "dost say"],
  [/\bthink\b/gi, "dost think"],
  [/\bwant\b/gi, "dost desire"],
  [/\bneed\b/gi, "dost require"],
  [/\blike\b/gi, "dost fancy"],
  [/\blove\b/gi, "dost love"],
  [/\bhate\b/gi, "dost despise"],
  // Pokemon / scientific vocabulary
  [/\bcapable\b/gi, "able"],
  [/\binstantly\b/gi, "in a trice"],
  [/\btransform(?:s|ed|ing)?\b/gi, "transfigure"],
  [/\bduplicate\b/gi, "likeness"],
  [/\bscientists?\b/gi, "alchemist"],
  [/\bexperiments?\b/gi, "trials"],
  [/\bgenetic\b/gi, "essential"],
  [/\belectricity\b/gi, "galvanic force"],
  [/\bgather(?:s|ed|ing)?\b/gi, "assemble"],
  [/\bhorrific\b/gi, "most dreadful"],
  [/\bcreatures?\b/gi, "beast"],
  [/\bcopying\b/gi, "mimicking"],
  [/\bcopies\b/gi, "mimics"],
  [/\bcopy\b/gi, "mimic"],
  [/\blightning\b/gi, "thunderbolt"],
  [/\bstorms?\b/gi, "tempest"],
  [/\battack(?:s|ed|ing)?\b/gi, "assail"],
  [/\bdefend(?:s|ed|ing)?\b/gi, "shield"],
  [/\bdestroy(?:s|ed|ing)?\b/gi, "lay waste to"],
  [/\bseveral\b/gi, "sundry"],
  [/\bcaus(?:e|es|ed|ing)\b/gi, "bring forth"],
  [/\bbuild(?:s|t|ing)?\b/gi, "amass"],
  [/\bevolve(?:s|d|ing)?\b/gi, "transmute"],
  [/\bwild\b/gi, "untamed"],
  [/\babilit(?:y|ies)\b/gi, "gift"],
  [/\bpowers?\b/gi, "might"],
  [/\bpowerful\b/gi, "mighty"],
  [/\brake\b/gi, "uncommon"],
  [/\bcreated?\b/gi, "fashioned"],
  [/\bsplicing\b/gi, "fusing"],
  [/\bsplice(?:s|d)?\b/gi, "fuse"],
  [/\bengineering\b/gi, "alchemy"],
  [/\benerg(?:y|ies)\b/gi, "vital force"],
  [/\bspecies\b/gi, "manner of creature"],
  [/\bevolut(?:ion|ionary)\b/gi, "transmutation"],
  [/\bflames?\b/gi, "fire"],
  [/\bwings?\b/gi, "great pinions"],
  [/\bclaws?\b/gi, "talons"],
  [/\bfangs?\b/gi, "sharp teeth"],
  [/\btails?\b/gi, "appendage"],
  [/\bshell\b/gi, "hard carapace"],
  [/\brelease(?:s|d|ing)?\b/gi, "unleash"],
  [/\babsorb(?:s|ed|ing)?\b/gi, "draw unto"],
  [/\bemit(?:s|ted|ting)?\b/gi, "give forth"],
  [/\bgenerat(?:es?|ed|ing)\b/gi, "conjure"],
  [/\bsplendid\b/gi, "most wondrous"],
  [/\bbody\b/gi, "form"],
  [/\bminds?\b/gi, "wit"],
  [/\bbrains?\b/gi, "wit"],
  [/\bfight(?:s|ing)?\b/gi, "duel"],
  [/\bfought\b/gi, "didst duel"],
  // General vocabulary
  [/\byes\b/gi, "aye"],
  [/\bno\b/gi, "nay"],
  [/\bvery\b/gi, "most"],
  [/\breally\b/gi, "verily"],
  [/\bactually\b/gi, "forsooth"],
  [/\bplease\b/gi, "prithee"],
  [/\bthanks\b/gi, "gramercy"],
  [/\bhello\b/gi, "hark"],
  [/\bhi\b/gi, "hark"],
  [/\bbye\b/gi, "fare thee well"],
  [/\bgoodbye\b/gi, "fare thee well"],
  [/\bfriend\b/gi, "good fellow"],
  [/\bfriends\b/gi, "good fellows"],
  [/\benemy\b/gi, "foe"],
  [/\benemies\b/gi, "foes"],
  [/\bman\b/gi, "knave"],
  [/\bwoman\b/gi, "maiden"],
  [/\bguy\b/gi, "fellow"],
  [/\bgirl\b/gi, "lass"],
  [/\bboy\b/gi, "lad"],
  [/\bold\b/gi, "ancient"],
  [/\bnew\b/gi, "novel"],
  [/\bgood\b/gi, "noble"],
  [/\bbad\b/gi, "foul"],
  [/\bgreat\b/gi, "wondrous"],
  [/\bawesome\b/gi, "most wondrous"],
  [/\bterrible\b/gi, "most foul"],
  [/\bbeautiful\b/gi, "fair"],
  [/\bugly\b/gi, "most vile"],
  [/\bsmart\b/gi, "learned"],
  [/\bstupid\b/gi, "witless"],
  [/\bcrazy\b/gi, "mad"],
  [/\bhappy\b/gi, "merry"],
  [/\bsad\b/gi, "melancholy"],
  [/\bangry\b/gi, "wrathful"],
  [/\bscared\b/gi, "afeared"],
  [/\bhouse\b/gi, "dwelling"],
  [/\bhome\b/gi, "abode"],
  [/\bwork\b/gi, "toil"],
  [/\bjob\b/gi, "occupation"],
  [/\bmoney\b/gi, "coin"],
  [/\btime\b/gi, "hour"],
  [/\bday\b/gi, "morrow"],
  [/\bnight\b/gi, "eve"],
  [/\btoday\b/gi, "this day"],
  [/\btomorrow\b/gi, "the morrow"],
  [/\byesterday\b/gi, "the day past"],
  [/\bnow\b/gi, "at this hour"],
  [/\bsoon\b/gi, "ere long"],
  [/\blater\b/gi, "anon"],
  [/\bnever\b/gi, "ne'er"],
  [/\balways\b/gi, "e'er"],
  [/\beveryone\b/gi, "all souls"],
  [/\beverybody\b/gi, "all souls"],
  [/\bsomething\b/gi, "some matter"],
  [/\bnothing\b/gi, "naught"],
  [/\beverything\b/gi, "all things"],
  [/\banywhere\b/gi, "whither"],
  [/\bsomewhere\b/gi, "yonder"],
];

const SHAKESPEARE_FLOURISHES = [
  "Hark! ",
  "Prithee, ",
  "Forsooth, ",
  "Marry, ",
  "Good morrow! ",
  "Lo! ",
  "Verily, ",
  "Mark well! ",
  "Hear me! ",
  "Zounds! ",
];

function translateToShakespeare(text: string): string {
  const { processed, tokens } = preserveProperNouns(text);

  let result = processed;
  for (const [pattern, replacement] of SHAKESPEARE_MAP) {
    result = result.replace(pattern, (match) => {
      if (match[0] === match[0].toUpperCase() && match[0] !== match[0].toLowerCase()) {
        return replacement.charAt(0).toUpperCase() + replacement.slice(1);
      }
      return replacement;
    });
  }

  const flourish = SHAKESPEARE_FLOURISHES[text.length % SHAKESPEARE_FLOURISHES.length];
  const flourishWordPattern = /^(Hark|Prithee|Forsooth|Marry|Good morrow|Lo|Verily|Mark well|Hear me|Zounds)/i;
  if (!flourishWordPattern.test(result.trim())) {
    result = flourish + result.charAt(0).toLowerCase() + result.slice(1);
    result = result.charAt(0).toUpperCase() + result.slice(1);
  }

  const joined = result.trim();
  return restoreProperNouns(joined, tokens);
}

// ---------------------------------------------------------------------------
// Main fetch handler
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const apiPath = path.startsWith("/v1/") ? path.slice(3) : path;

    if (!apiPath.startsWith("/translate/")) {
      return errorResponse("Not found", 404);
    }

    if (request.method !== "POST") {
      return errorResponse("Method not allowed. Use POST.", 405);
    }

    const translationType = apiPath.replace("/translate/", "").toLowerCase().replace(/\.json$/, "");
    if (translationType !== "yoda" && translationType !== "shakespeare") {
      return errorResponse(
        `Unknown translation type "${translationType}". Use /translate/yoda or /translate/shakespeare.`,
        404
      );
    }

    // Rate limiting via Durable Object — one instance per client IP
    const ip =
      request.headers.get("cf-connecting-ip") ??
      request.headers.get("x-forwarded-for") ??
      "unknown";

    const doId = env.RATE_LIMITER.idFromName(ip);
    const rateLimiter = env.RATE_LIMITER.get(doId);
    const rateResponse = await rateLimiter.fetch(request.url);
    const rateResult = await rateResponse.json<{ allowed: boolean; retryAfter?: number }>();

    if (!rateResult.allowed) {
      console.log(JSON.stringify({ level: "warn", event: "rate_limit", ip, retry_after: rateResult.retryAfter }));
      return jsonResponse(
        {
          error: {
            code: 429,
            message: "Too many requests. You have exceeded the rate limit of 5 calls per minute.",
          },
          retry_after: rateResult.retryAfter,
        },
        429
      );
    }

    // Parse request body — supports JSON, form-urlencoded, and multipart/form-data
    let text: unknown;
    const contentType = request.headers.get("content-type") ?? "";
    try {
      if (contentType.includes("application/json")) {
        const body = await request.json<{ text?: unknown }>();
        text = body?.text;
      } else if (
        contentType.includes("application/x-www-form-urlencoded") ||
        contentType.includes("multipart/form-data")
      ) {
        const formData = await request.formData();
        text = formData.get("text");
      } else {
        // Default: attempt JSON, fall back to form data
        const raw = await request.text();
        try {
          const body = JSON.parse(raw) as { text?: unknown };
          text = body?.text;
        } catch {
          const params = new URLSearchParams(raw);
          text = params.get("text");
        }
      }
    } catch {
      return errorResponse("Could not parse request body.", 400);
    }
    if (typeof text !== "string" || text.trim().length === 0) {
      return errorResponse('Missing or empty "text" field in request body.', 400);
    }

    const translated =
      translationType === "yoda"
        ? translateToYoda(text.trim())
        : translateToShakespeare(text.trim());

    return jsonResponse({
      success: { total: 1 },
      contents: {
        translated,
        text: text.trim(),
        translation: translationType,
      },
    });
  },
} satisfies ExportedHandler<Env>;
