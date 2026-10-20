// The Supabase pack's guard, loaded by prod-guard (.ssdd/hooks/prod-guard.mjs).
// Judges what reaches the production Supabase project, by what it does
// (SPEC v3 Part 4). Source: the source project's supabase-guard, with the
// handover's fixes applied here.
//
// The CLI (any word whose name is `supabase`, so npx / bunx / pnpm dlx /
// version pins / runners need no list; --help and -h never ask; --local is
// local):
//   writes   db push (not --dry-run), migration repair, functions
//            deploy|delete, config push, secrets set|unset, storage rm|mv,
//            storage cp to ss://, and a management write (projects / branches /
//            backups / domains / … create|delete|update|restore|…)
//   remote   db reset, migration up|down, db query: with --linked, or a
//            --db-url whose host isn't local
//   db query on a remote is judged by its SQL (sql-readonly.mjs): a read or a
//            proof in the configured frame passes; writes ask "writes";
//            anything else asks "can't tell" — so do a -f file that is
//            missing, over 1 MiB, not literal, relative after a cd, or named
//            anywhere else in the call (the hook runs before the call, so it
//            would read the file as it was), stdin, two SQL sources, an
//            expansion in inline SQL, and a PG* variable set on the command.
// A call naming supabase that the shell view can't parse asks "can't tell".
import { readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { classifySql } from './sql-readonly.mjs';

export const name = 'supabase';

const isArray = (v, of) => Array.isArray(v) && v.every((x) => typeof x === of);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// productionGuard.supabase → '' or what's wrong with it.
export function validate(o) {
  if (!isObject(o)) return 'must be an object';
  for (const k of Object.keys(o)) {
    if (!['proofFrame', 'liveExtensions', 'personalReads', '$comment'].includes(k)) return `unknown option "${k}"`;
  }
  if ('proofFrame' in o) {
    const f = o.proofFrame;
    if (!isObject(f) || !isArray(f.prologue, 'string') || !isArray(f.epilogue, 'string') || !f.prologue.length || !f.epilogue.length) {
      return '"proofFrame" must be { prologue: [lines], epilogue: [lines] }';
    }
  }
  if ('liveExtensions' in o && !isArray(o.liveExtensions, 'string')) return '"liveExtensions" must be a list of names';
  if ('personalReads' in o) {
    const p = o.personalReads;
    if (!isObject(p) || ('tables' in p && !isArray(p.tables, 'string')) || ('columns' in p && !isArray(p.columns, 'string'))) {
      return '"personalReads" must be { tables: [names], columns: [names] }';
    }
  }
  return '';
}

export const mentions = (text) => /supabase/i.test(String(text ?? ''));

const base = (w) => String(w ?? '').split('/').pop();
const isCli = (w) => base(w).toLowerCase().replace(/@.*$/, '') === 'supabase';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'host.docker.internal', '0.0.0.0']);
// Global and subcommand flags that take the next word as their value.
const VALUE_FLAGS = new Set(['--workdir', '--profile', '-o', '--output', '--db-url', '-f', '--file', '-p', '--password',
  '--project-ref', '--network-id', '--dns-resolver', '--schema', '-s', '--status', '--last', '--env-file',
  '--import-map', '--org-id', '--region', '--name', '--db-password', '--plan', '--timestamp', '--version']);
const MANAGEMENT = new Set(['projects', 'branches', 'backups', 'domains', 'sso', 'orgs', 'network-restrictions',
  'network-bans', 'postgres-config', 'ssl-enforcement', 'vanity-subdomains', 'snippets', 'encryption', 'seed']);
const WRITE_VERBS = new Set(['create', 'delete', 'update', 'remove', 'add', 'activate', 'restore', 'pause', 'unpause',
  'set', 'unset', 'reverify', 'update-root-key', 'buckets']);
const MAX_SQL = 1024 * 1024;

const writes = (what) => ({ decision: 'ask', kind: 'writes', what });
const unclear = (what, why) => ({ decision: 'ask', kind: 'unclear', what, why });

// The value of a flag in words (`--f v` or `--f=v`), all occurrences.
function values(words, flags) {
  const out = [];
  for (let k = 0; k < words.length; k++) {
    for (const f of flags) {
      if (words[k] === f && k + 1 < words.length) out.push(words[k + 1]);
      else if (f.startsWith('--') && words[k].startsWith(`${f}=`)) out.push(words[k].slice(f.length + 1));
    }
  }
  return out;
}

function dbUrlIsLocal(url) {
  try { return LOCAL_HOSTS.has(new URL(url).hostname); } catch { return false; }
}

// --linked (not =false), or a --db-url that isn't local.
function targetsRemote(rest) {
  if (rest.some((w) => w === '--linked' || (w.startsWith('--linked=') && w !== '--linked=false'))) return true;
  return values(rest, ['--db-url']).some((u) => !dbUrlIsLocal(u));
}

// The SQL a command runs: { sql } or { why } when it can't be read.
function readSqlFile(path, ctx) {
  if (/[$`*?[]/.test(path) || path.startsWith('~')) return { why: "the -f path isn't literal" };
  if (!isAbsolute(path)) {
    const moved = ctx.commands.some((w) => ['cd', 'pushd', 'popd'].includes(base(w[0])));
    if (moved) return { why: 'a relative -f path after a cd' };
  }
  const full = isAbsolute(path) ? path : resolve(ctx.cwd, path);
  const name = basename(path);
  if (ctx.raw.split(name).length - 1 > 1) return { why: `${name} is named elsewhere in this call, so it may change before this runs` };
  let st;
  try { st = statSync(full); } catch { return { why: `the -f file is missing (${path})` }; }
  if (!st.isFile()) return { why: "the -f path isn't a regular file" };
  if (st.size > MAX_SQL) return { why: 'the -f file is over 1 MiB' };
  try { return { sql: readFileSync(full, 'utf8') }; } catch (e) { return { why: `the -f file can't be read (${e.code ?? e.message})` }; }
}

// A verdict for SQL that reaches production, or null for a read.
export function judgeSql(sql, what, ctx) {
  const c = classifySql(sql, ctx.options);
  if (c.verdict === 'read' || c.verdict === 'proof') {
    return c.personal ? { decision: 'ask', kind: 'personal', what, why: c.personal.join(', ') } : null;
  }
  if (c.verdict === 'writes') return writes(`${what} (${c.rule})`);
  return unclear(what, c.rule);
}

function judgeQuery(words, i, positionals, ctx) {
  const what = 'supabase db query';
  const pg = words.slice(0, i).find((w) => /^PG[A-Z_]+=/.test(w));
  if (pg) return unclear(what, `it sets ${pg.split('=')[0]}`);
  const rest = words.slice(i + 1);
  const files = values(rest, ['-f', '--file']);
  const q = positionals.indexOf('query');
  const inline = q >= 0 ? positionals.slice(q + 1) : [];
  if (rest.some((w) => /^\d*<(?!<)/.test(w))) return unclear(what, 'it reads SQL from stdin');
  if (files.length + inline.length > 1) return unclear(what, 'it has more than one SQL source');
  if (!files.length && !inline.length) return unclear(what, 'no SQL found');
  if (inline.length) {
    if (/`|\$[({A-Za-z_]/.test(inline[0])) return unclear(what, "the inline SQL isn't literal");
    return judgeSql(inline[0], what, ctx);
  }
  const file = readSqlFile(files[0], ctx);
  return file.why ? unclear(what, file.why) : judgeSql(file.sql, what, ctx);
}

// One command with a `supabase` word at i → a verdict, or null.
function judgeCli(words, i, ctx) {
  const rest = words.slice(i + 1);
  if (rest.includes('--help') || rest.includes('-h') || rest[0] === 'help') return null;
  if (rest.includes('--local')) return null;
  const positionals = [];
  for (let k = 0; k < rest.length; k++) {
    if (VALUE_FLAGS.has(rest[k])) { k++; continue; }
    if (rest[k].startsWith('-') || /^\d*[<>]/.test(rest[k])) continue;
    positionals.push(rest[k]);
  }
  const p = ` ${positionals.join(' ')} `;
  const has = (s) => p.includes(` ${s} `);
  if (has('db push')) return rest.includes('--dry-run') ? null : writes('supabase db push');
  if (has('db query')) return targetsRemote(rest) ? judgeQuery(words, i, positionals, ctx) : null;
  if (has('db reset')) return targetsRemote(rest) ? writes('supabase db reset (remote)') : null;
  for (const dir of ['up', 'down']) if (has(`migration ${dir}`)) return targetsRemote(rest) ? writes(`supabase migration ${dir} (remote)`) : null;
  for (const s of ['migration repair', 'functions deploy', 'functions delete', 'config push', 'secrets set',
    'secrets unset', 'storage rm', 'storage mv']) if (has(s)) return writes(`supabase ${s}`);
  if (has('storage cp')) return String(positionals[positionals.length - 1] ?? '').startsWith('ss://') ? writes('supabase storage cp (an upload)') : null;
  if (MANAGEMENT.has(positionals[0]) && WRITE_VERBS.has(positionals[1])) return writes(`supabase ${positionals[0]} ${positionals[1]}`);
  return null;
}

export function judgeShell(ctx) {
  const out = [];
  for (const words of ctx.commands) {
    const i = words.findIndex(isCli);
    if (i < 0) continue;
    const v = judgeCli(words, i, ctx);
    if (v) out.push(v);
  }
  if (ctx.unparsed.some(mentions)) out.push(unclear('a command naming supabase', "it can't be parsed"));
  return out;
}

export function judgeMcp() {
  return null;
}
