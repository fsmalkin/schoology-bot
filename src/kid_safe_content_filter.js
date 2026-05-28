import { normalizeAscii } from "./text_utils.js";

export const KID_SAFE_OUTPUT_FALLBACK =
  "I found content that may not be appropriate for kids, so I am not going to send it here. I can help reframe this as a school-safe question.";

const CATEGORY_PATTERNS = [
  {
    category: "adult_sexual",
    patterns: [
      /\b(?:porn(?:ography)?|pornhub|xxx|onlyfans|nudes?|sext(?:ing)?|erotic|orgasm|masturbat(?:e|ion|ing)?|blowjob|handjob|deepthroat|hentai|fetish)\b/i,
      /\b(?:sex|sexual)\s+(?:video|videos|pictures|pics|images|roleplay|story|stories|chat|sites?|content)\b/i,
      /\b(?:how\s+to|ways?\s+to)\s+(?:have\s+sex|perform\s+oral|masturbat)/i,
    ],
  },
  {
    category: "graphic_violence",
    patterns: [
      /\b(?:gore|beheading|decapitation|snuff|torture\s+video|dead\s+body|graphic\s+death)\b/i,
      /\b(?:how\s+to|ways?\s+to|best\s+way\s+to)\s+(?:kill|hurt|maim|torture)\b/i,
      /\b(?:school\s+shooting\s+video|mass\s+shooting\s+video)\b/i,
    ],
  },
  {
    category: "self_harm",
    patterns: [
      /\b(?:how\s+to|ways?\s+to|best\s+way\s+to|painless\s+way\s+to)\s+(?:kill\s+(?:myself|yourself)|die|commit\s+suicide|self[- ]?harm)\b/i,
      /\b(?:i\s+want\s+to|i'?m\s+going\s+to|im\s+going\s+to)\s+(?:kill\s+myself|die|self[- ]?harm)\b/i,
      /\bkill\s+myself\b/i,
    ],
  },
  {
    category: "dangerous_or_illegal",
    patterns: [
      /\b(?:how\s+to|ways?\s+to|instructions?\s+for)\s+(?:make|build|buy|hide|use|sell)\s+(?:a\s+)?(?:bomb|explosive|gun|weapon|meth|cocaine|heroin|drugs?|vape)\b/i,
      /\b(?:make|build)\s+(?:a\s+)?(?:bomb|explosive)\b/i,
      /\bbring\s+(?:a\s+)?(?:gun|knife|weapon)\s+to\s+school\b/i,
    ],
  },
  {
    category: "cyber_abuse",
    patterns: [
      /\b(?:hack|break\s+into|steal)\s+(?:schoology|school\s+account|an?\s+account|passwords?)\b/i,
      /\b(?:bypass|disable)\s+(?:school\s+filter|parental\s+controls?|monitoring)\b/i,
    ],
  },
  {
    category: "harassment",
    patterns: [
      /\b(?:how\s+to|ways?\s+to)\s+(?:bully|humiliate|harass)\b/i,
      /\b(?:write|make)\s+(?:a\s+)?(?:racist|sexist|homophobic)\s+(?:joke|insult|rant)\b/i,
    ],
  },
];

function normalizeForSafety(text) {
  return normalizeAscii(String(text || ""))
    .replace(/[\u0000-\u001F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectKidUnsafeContent(text) {
  const normalized = normalizeForSafety(text);
  if (!normalized) return { safe: true, categories: [], normalized };

  const categories = [];
  for (const entry of CATEGORY_PATTERNS) {
    if (entry.patterns.some((pattern) => pattern.test(normalized))) {
      categories.push(entry.category);
    }
  }

  return {
    safe: categories.length === 0,
    categories,
    normalized,
  };
}

export function buildKidSafeBlockedReply(safety = {}) {
  const categories = new Set(Array.isArray(safety.categories) ? safety.categories : []);
  if (categories.has("self_harm")) {
    return [
      "I cannot help with that kind of unsafe request.",
      "If anyone might be in immediate danger, tell a trusted adult now. In the U.S., call or text 988 for urgent support.",
      "I can still help with schoolwork, reminders, or a safer next step.",
    ].join("\n");
  }

  return [
    "I cannot help with content that may be unsafe or inappropriate for kids.",
    "I can help with Schoology, homework planning, reminders, or a school-safe web lookup.",
  ].join("\n");
}

export function safetyDebugPayload(stage, safety = {}) {
  return {
    blocked: true,
    stage,
    categories: Array.isArray(safety.categories) ? safety.categories : [],
  };
}
