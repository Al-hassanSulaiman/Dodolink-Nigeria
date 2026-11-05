// A conservative filter for clearly objectionable words in text people publish (messages, reviews,
// product and store text). It matches whole words only, so ordinary words are never caught by
// accident. It is a safety net: the real protection is Report, Block and the team removing content.
const BLOCKED_WORDS = [
  // sexual and explicit
  "porn", "porno", "pornography", "xxx", "rape", "rapist", "blowjob", "handjob", "milf", "sexting",
  // hateful or abusive
  "nigger", "niggers", "nigga", "faggot", "faggots", "retard", "retarded", "kike", "chink", "spic",
  // threats and self-harm bait
  "kill yourself", "kys",
  // illegal goods
  "cocaine", "heroin", "meth", "crystal meth", "mdma", "marijuana", "cannabis", "codeine syrup",
  "ak47", "ak-47", "pistol for sale", "guns for sale", "firearms for sale",
];

const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PATTERN = new RegExp(`(?<![\\p{L}\\p{N}])(?:${BLOCKED_WORDS.map(w => escape(w).replace(/\s+/g, "\\s+")).join("|")})(?![\\p{L}\\p{N}])`, "iu");

/** Fold look-alike characters and repeated letters so "p0rn" or "pooorn" is still caught. */
function normalize(text: string): string {
  return text
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[0]/g, "o").replace(/[1!|]/g, "i").replace(/[3]/g, "e").replace(/[4@]/g, "a").replace(/[5$]/g, "s")
    .replace(/(.)\1{2,}/g, "$1$1");
}

export function containsObjectionable(text: string): boolean {
  if (!text) return false;
  return PATTERN.test(text) || PATTERN.test(normalize(text));
}

export const OBJECTIONABLE_MESSAGE =
  "This contains language or items that are not allowed on Dodolink NG. Please change it and try again.";
