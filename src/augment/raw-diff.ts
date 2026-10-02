/**
 * Raw unified-diff reply parsing for `draft-patch` and `repair-patch`.
 *
 * A unified diff is self-delimiting (`--- a/x`, `+++ b/x`, `@@`), so forcing
 * it through a JSON string envelope only invites escape errors and
 * mid-string truncation. These helpers accept the model's reply text as-is:
 * the diff is whatever runs from the first diff header to the last
 * diff-grammar line, and assumptions are trailing `Assumption: …` lines
 * parsed separately. Surrounding prose (and a ```diff fence) is tolerated
 * and ignored.
 */

export interface RawDraftReply {
  patch: string;
  assumptions: string[];
}

/** First line of a file section in a unified diff. */
const DIFF_START = /^(diff --git |--- )/;

/**
 * Any line that may legally continue a unified diff: git extended headers,
 * hunk headers, and body lines (context ' ', addition '+', removal '-',
 * '\ No newline at end of file'). The first line that matches none of these
 * ends the diff.
 */
const DIFF_LINE = /^(diff --git |--- |\+\+\+ |@@ |index |old mode |new mode |new file mode |deleted file mode |similarity index |dissimilarity index |rename from |rename to |rename old |rename new |copy from |copy to |Binary files |GIT binary patch |[ +\\-])/;

const ASSUMPTION_LINE = /^Assumption:[ \t]?(.*)$/;

/**
 * Drop Markdown fence delimiter lines. A unified diff body line always
 * starts with a marker (context ' ', addition '+', removal '-', '\'), so a
 * fence at column 0 can never be diff content — but content around a fence
 * (assumptions after the closing fence) must survive.
 */
function unfence(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => !line.startsWith("```"));
}

/**
 * Extracts the unified diff and trailing assumption lines from a raw draft
 * reply. Returns `undefined` when the text contains no diff header — the
 * caller treats that as an unparseable reply, not an empty patch.
 */
export function parseRawDraftReply(text: string): RawDraftReply | undefined {
  const lines = unfence(text);
  const start = lines.findIndex((line) => DIFF_START.test(line));
  if (start < 0) return undefined;
  let end = start;
  for (let index = start; index < lines.length; index++) {
    if (DIFF_LINE.test(lines[index]!)) end = index;
    else break;
  }
  const patch = lines.slice(start, end + 1).join("\n");
  if (!patch.trim()) return undefined;
  const assumptions: string[] = [];
  for (let index = end + 1; index < lines.length; index++) {
    const line = lines[index]!;
    if (!line.trim()) continue;
    const assumption = line.match(ASSUMPTION_LINE)?.[1]?.trim();
    if (assumption) assumptions.push(assumption);
    // Other trailing prose is ignored: the diff is the answer, chatter
    // around it is not a failure.
  }
  return { patch, assumptions };
}
