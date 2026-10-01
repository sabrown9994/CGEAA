// Matches SDF's missing-object-reference line, e.g.:
//   The object reference [scriptid=customrecord_foo] is missing in the project
//   and also not included in the dependencies list.
// Verbatim phrasing confirmed in ndf/docs/sdf-dependency-findings.md (Task 1).
const MISSING_REF_RE = /The object reference \[scriptid=([^\]]+)\] is missing in the project/gi;

export function parseMissingObjectRefs(output: string): string[] {
  const ids = new Set<string>();
  for (const m of output.matchAll(MISSING_REF_RE)) {
    ids.add(m[1]);
  }
  return [...ids];
}
