import { ChatMessage } from "./types";

const STRONG_INDICATORS: RegExp[] = [
  /\bgithub\b/i,
  /\brepos?tories?\b/i,
  /\brepo\b/i,
  /\bgit\b/i,
  /\bpull request\b/i,
  /\bpr\s*#?\d*\b/i,
  /\bissue\b/i,
  /\bcommit\b/i,
  /\bbranch\b/i,
  /\bmerge\b/i,
  /\bpush\b/i,
  /\bclone\b/i,
  /\bfork\b/i,
  /\bworkflow\b/i,
  /\bactions?\b/i,
  /\bruns?\b/i,
  /\bchecks?\b/i,
  /\bci\b/i,
  /\bfile\b/i,
  /\bfiles\b/i,
  /\bfolder\b/i,
  /\bdirectory\b/i,
  /\btree\b/i,
  /\binspect\b/i,
  /\bread\b/i,
  /\bcode\b/i,
  /\breadme\b/i,
  /\blicense\b/i,
  /\bchangelog\b/i,
  /\brefactor\b/i,
  /\bimplement\b/i,
  /\bopen source\b/i,
  /\bstar\b/i,
  /[\w.-]+\/[\w.-]+/,
  /\b\.(ts|tsx|js|jsx|py|go|rs|md|json|yml|yaml|sh|css|html)\b/i,
];

export function likelyNeedsGitHub(messages: readonly ChatMessage[]): boolean {
  for (const m of messages) {
    if (m.role !== "user") continue;
    if (STRONG_INDICATORS.some((re) => re.test(m.content))) return true;
  }
  return false;
}
