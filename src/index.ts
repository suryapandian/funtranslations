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
// Limit: 5 requests per hour, matching the FunTranslations free-tier.
// ---------------------------------------------------------------------------

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: { code: status, message } }, status);
}

// ---------------------------------------------------------------------------
// Yoda translator
//
// Strategy:
//   1. Split text into sentences.
//   2. For each sentence, apply word-level replacements.
//   3. Rearrange clause structure: move the predicate/object before the subject+verb.
//   4. Append a Yoda filler phrase occasionally.
// ---------------------------------------------------------------------------

const YODA_WORD_MAP: Array<[RegExp, string]> = [
  [/\bvery\b/gi, "most"],
  [/\breally\b/gi, "truly"],
  [/\bgreat\b/gi, "powerful"],
  [/\bgood\b/gi, "worthy"],
  [/\bbad\b/gi, "unworthy"],
  [/\bfriend\b/gi, "ally"],
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
];

function rearrangeToYoda(sentence: string): string {
  const trailingPunct = sentence.match(/[.!?,;]+$/)?.[0] ?? "";
  const core = sentence.replace(/[.!?,;]+$/, "").trim();

  if (!core) return sentence;

  const splitPatterns = [
    /^(.+?),\s+(.+)$/,
    /^(.+?)\s+because\s+(.+)$/i,
    /^(.+?)\s+but\s+(.+)$/i,
    /^(.+?)\s+and\s+(.+)$/i,
    /^(.+?)\s+so\s+(.+)$/i,
    /^(.+?)\s+that\s+(.+)$/i,
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
  let result = text;
  for (const [pattern, replacement] of YODA_WORD_MAP) {
    result = result.replace(pattern, replacement);
  }

  const sentences = result.match(/[^.!?]+[.!?]*/g) ?? [result];
  const rearranged = sentences.map((s) => rearrangeToYoda(s.trim()));

  const filler =
    YODA_FILLERS[Math.floor(Math.abs(Math.sin(text.length * 13)) * YODA_FILLERS.length)];
  const last = rearranged[rearranged.length - 1];
  rearranged[rearranged.length - 1] = last.replace(/[.!?]*$/, "") + filler;

  return rearranged.join(" ").trim();
}

// ---------------------------------------------------------------------------
// Shakespeare translator
//
// Strategy:
//   1. Apply pronoun replacements (you → thou/thee, your → thy, etc.)
//   2. Apply verb conjugation replacements (are → art, have → hast, etc.)
//   3. Apply vocabulary replacements.
//   4. Prepend or append an Elizabethan flourish.
// ---------------------------------------------------------------------------

const SHAKESPEARE_MAP: Array<[RegExp, string]> = [
  // Contractions first (must come before individual word replacements)
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
  [/\bare\b/gi, "art"],
  [/\bwere\b/gi, "wert"],
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
  // Vocabulary
  [/\byes\b/gi, "aye"],
  [/\bno\b/gi, "nay"],
  [/\bvery\b/gi, "most"],
  [/\breally\b/gi, "verily"],
  [/\bactually\b/gi, "forsooth"],
  [/\bplease\b/gi, "prithee"],
  [/\bthanks\b/gi, "gramercy"],
  [/\bthank you\b/gi, "gramercy"],
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
];

function translateToShakespeare(text: string): string {
  let result = text;
  for (const [pattern, replacement] of SHAKESPEARE_MAP) {
    result = result.replace(pattern, (match) => {
      if (match[0] === match[0].toUpperCase() && match[0] !== match[0].toLowerCase()) {
        return replacement.charAt(0).toUpperCase() + replacement.slice(1);
      }
      return replacement;
    });
  }

  const flourish = SHAKESPEARE_FLOURISHES[text.length % SHAKESPEARE_FLOURISHES.length];
  const flourishWordPattern = /^(Hark|Prithee|Forsooth|Marry|Good morrow)/i;
  if (!flourishWordPattern.test(result.trim())) {
    result = flourish + result.charAt(0).toLowerCase() + result.slice(1);
    result = result.charAt(0).toUpperCase() + result.slice(1);
  }

  return result.trim();
}

// ---------------------------------------------------------------------------
// Main fetch handler
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (!path.startsWith("/translate/")) {
      return errorResponse("Not found", 404);
    }

    if (request.method !== "POST") {
      return errorResponse("Method not allowed. Use POST.", 405);
    }

    const translationType = path.replace("/translate/", "").toLowerCase();
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
      return jsonResponse(
        {
          error: {
            code: 429,
            message: "Too many requests. You have exceeded the rate limit of 5 calls per hour.",
          },
          retry_after: rateResult.retryAfter,
        },
        429
      );
    }

    // Parse request body
    let body: { text?: unknown };
    try {
      body = await request.json();
    } catch {
      return errorResponse("Invalid JSON body.", 400);
    }

    const text = body?.text;
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
