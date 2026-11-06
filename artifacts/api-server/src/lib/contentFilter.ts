// Basic filter for objectionable text (App Store guideline 1.2). It is a
// safety net, not a replacement for user reports and admin review.
const BLOCKED_WORDS = [
  "fuck", "fucking", "motherfucker", "bitch", "bastard", "asshole", "dickhead", "pussy", "cunt",
  "nigger", "nigga", "faggot", "whore", "slut", "rape", "rapist", "porn", "nude", "nudes", "sex video",
  "onyeoma", "ashawo", "olodo", "kill yourself",
];

const PATTERN = new RegExp(
  `(^|[^a-z0-9])(${BLOCKED_WORDS.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+")).join("|")})(?=$|[^a-z0-9])`,
  "i",
);

export function containsObjectionable(...texts: Array<string | null | undefined>): boolean {
  return texts.some(t => typeof t === "string" && t.length > 0 && PATTERN.test(t.normalize("NFKD")));
}

export const OBJECTIONABLE_MESSAGE =
  "This contains language that is not allowed on DodoLink. Please remove it and try again.";
