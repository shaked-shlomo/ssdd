// Claude model ids, shared by review-gate (reviewer-model floors) and
// work-state (the new-model reminder).

// `claude-opus-5-5`, `claude-sonnet-5-5-20260101`, `claude-opus-6` → { family,
// version }; the older `claude-3-5-sonnet-…` order too. null if unrecognized.
export function parseModel(id) {
  const s = String(id).toLowerCase();
  let m = /claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2}))?(?!\d)/.exec(s);
  if (m) return { family: m[1], version: [Number(m[2]), Number(m[3] ?? 0)] };
  m = /claude-(\d+)(?:-(\d{1,2}))?-(opus|sonnet|haiku)/.exec(s);
  if (m) return { family: m[3], version: [Number(m[1]), Number(m[2] ?? 0)] };
  return null;
}

// The model's generation, its major version; Cursor's dotted slugs
// (`claude-4.5-sonnet`) too. null for anything that isn't a Claude model id.
export function generationOf(id) {
  return parseModel(String(id ?? '').replace(/(\d)\.(\d)/g, '$1-$2'))?.version[0] ?? null;
}
