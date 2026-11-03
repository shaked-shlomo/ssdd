// The lines a `git diff -U0` adds, by path. Shared by convention-lint (it
// lints only added lines) and the review gate (a [pre-existing] finding on an
// added line isn't pre-existing, spec v3.5 Decision 4). convention-lint can't
// be imported: it reads stdin when loaded.

// A `+++ b/<path>` name: C-quoted ("…") when it holds a quote, a backslash or a
// control character (core.quotePath=false keeps other bytes literal).
export function diffPath(raw) {
  let p = raw;
  if (p.startsWith('"')) {
    const bytes = [];
    for (let i = 1; i < p.length - 1; i++) {
      if (p[i] !== '\\') { bytes.push(...Buffer.from(p[i])); continue; }
      const c = p[++i];
      if (/[0-7]/.test(c)) { bytes.push(parseInt(p.slice(i, i + 3), 8)); i += 2; continue; }
      bytes.push(({ n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11 })[c] ?? c.charCodeAt(0));
    }
    p = Buffer.from(bytes).toString('utf8');
  }
  return p.replace(/^b\//, '');
}
// `git diff -U0` → Map<path, [[lineNo, text]]> of the lines it adds. A hunk
// runs while its lines start with `+`, `-` or `\`, so inside one, `+++ x` is
// an added line `++ x`, not the next file's header. An added line that only
// gains or drops the file's final newline (`\ No newline at end of file`
// follows the side without one) is the removed line it replaces, not a new one.
export function addedLines(diff) {
  const out = new Map();
  let file = null;
  let hunk = null; // { n, removed, added: [{ n, text, eof }], last }
  const flush = () => {
    if (!file || !hunk) return;
    for (const a of hunk.added) {
      const same = hunk.removed.find((r) => !r.used && r.text === a.text && r.eof !== a.eof);
      if (same) same.used = true;
      else out.get(file).push([a.n, a.text]);
    }
  };
  for (const line of diff.split('\n')) {
    if (hunk && /^[-+\\]/.test(line)) {
      if (line[0] === '\\') { if (hunk.last) hunk.last.eof = true; continue; }
      hunk.last = { n: line[0] === '+' ? hunk.n++ : 0, text: line.slice(1), eof: false };
      (line[0] === '+' ? hunk.added : hunk.removed).push(hunk.last);
      continue;
    }
    flush();
    hunk = null;
    if (line.startsWith('+++ ')) {
      // git ends a name that holds a space with a tab
      file = line === '+++ /dev/null' ? null : diffPath(line.slice(4).replace(/\t$/, ''));
      if (file) out.set(file, out.get(file) ?? []);
      continue;
    }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (h) hunk = { n: Number(h[1]), removed: [], added: [], last: null };
  }
  flush();
  return out;
}
