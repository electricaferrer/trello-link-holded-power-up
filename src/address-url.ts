// Holded users often paste a Google Maps link into an address field. Pull that
// URL out of the surrounding address text so it can be linked directly.

const URL_CANDIDATE_REGEX = /https?:\/\/\S+/i;
const TRAILING_PUNCTUATION_REGEX = /[.,;:!?'"]+$/;
const BRACKET_PAIRS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

function countOf(text: string, character: string): number {
  return text.split(character).length - 1;
}

// Commas stay inside the URL (coordinates such as `@39.7,3.0,15z`), but
// punctuation and unbalanced closing brackets at the end belong to the prose.
function trimUrlCandidate(candidate: string): string {
  let url = candidate;
  for (;;) {
    let trimmed = url.replace(TRAILING_PUNCTUATION_REGEX, '');
    const last = trimmed.slice(-1);
    const opening = BRACKET_PAIRS[last];
    if (opening && countOf(trimmed, last) > countOf(trimmed, opening)) {
      trimmed = trimmed.slice(0, -1);
    }
    if (trimmed === url) return url;
    url = trimmed;
  }
}

function cleanAddressText(text: string): string {
  return text
    .replace(/\(\s*\)|\[\s*\]|\{\s*\}/g, '')
    .replace(/\s*,(?:\s*[,.;:])+\s*/g, ', ')
    .replace(/^[\s,.;:]+|[\s,.;:]+$/g, '')
    .replace(/\s+/g, ' ');
}

export function splitAddressUrl(text: string): { url: string; rest: string } | undefined {
  const match = text.match(URL_CANDIDATE_REGEX);
  if (!match) return undefined;

  const candidate = trimUrlCandidate(match[0]);
  let url: string;
  try {
    url = new URL(candidate).href;
  } catch {
    return undefined;
  }

  const start = match.index || 0;
  const rest = cleanAddressText(
    `${text.slice(0, start)} ${text.slice(start + candidate.length)}`,
  );
  return { url, rest };
}

export function removeAddressUrls(text: string): string {
  let result = text;
  for (let split = splitAddressUrl(result); split; split = splitAddressUrl(result)) {
    result = split.rest;
  }
  return result;
}
