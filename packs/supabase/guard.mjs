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
// HTTP: curl / wget to api.supabase.com or a project's *.supabase.co API
//   passes GET and HEAD and asks "writes" on any other method (-X, data,
//   form and upload flags); a non-literal URL naming supabase asks "can't
//   tell" for a non-GET; an interpreter (node, python3 …) naming one of those
//   hosts asks "can't tell". grep / echo naming them pass.
// psql (and pg_restore) aimed at a Supabase host is judged like db query:
//   -c / -f reads pass, writes ask, interactive or stdin use and a target
//   that isn't literal ask "can't tell". pg_dump is a read.
// MCP (judgeMcp): a call is Supabase's when its server's name has
//   `supabase`, its URL is Supabase's, its tool is one only Supabase has, or
//   its project_id is a project ref. Known reads pass; execute_sql is judged
//   by its SQL; every other tool asks (owner ruling, 2026-10-21).
// A call naming supabase that the shell view can't parse asks "can't tell".
import { lstatSync, readFileSync } from 'node:fs';
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
// Commands that may run before a `db query -f` in the same call: none of them
// writes a file (a redirection makes any of them unsafe).
const SAFE_BEFORE = new Set(['cd', 'echo', 'printf', 'ls', 'cat', 'pwd', 'true', 'sleep', 'date', 'export', 'which',
  'test', '[', 'grep', 'head', 'tail', 'wc', 'jq']);
// A command that targets the remote project passes only when it's one of these reads.
const READ_GROUPS = new Set(['inspect', 'gen', 'link', 'unlink', 'status', 'services', 'login', 'logout', 'init', 'start', 'stop']);
const READ_VERBS = new Set(['list', 'get', 'show', 'info', 'ls', 'download', 'fetch', 'diff', 'dump', 'lint', 'api-keys',
  'get-root-key', 'new']);
const MAX_SQL = 1024 * 1024;

const writes = (what) => ({ decision: 'ask', kind: 'writes', what });
const unclear = (what, why) => ({ decision: 'ask', kind: 'unclear', what, why });

// A CLI's words after `supabase` → { positionals, flags, values(names) }: the
// value of a VALUE_FLAGS flag is neither a positional nor a flag, so
// `--password --dry-run` is a password.
function parseArgs(rest) {
  const positionals = [];
  const flags = [];
  const vals = [];
  for (let k = 0; k < rest.length; k++) {
    const w = rest[k];
    if (VALUE_FLAGS.has(w)) { vals.push([w, rest[k + 1] ?? '']); k++; continue; }
    if (/^-[^-]./.test(w) && VALUE_FLAGS.has(w.slice(0, 2))) { vals.push([w.slice(0, 2), w.slice(2)]); continue; } // -f/x.sql, -ojson
    if (w.startsWith('-')) {
      flags.push(w);
      const eq = w.indexOf('=');
      if (eq > 0) vals.push([w.slice(0, eq), w.slice(eq + 1)]);
      continue;
    }
    if (/^\d*[<>]/.test(w)) continue;
    positionals.push(w);
  }
  return { positionals, flags, values: (names) => vals.filter(([f]) => names.includes(f)).map(([, v]) => v) };
}

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

// Local only when every host in it is (`postgres://u@a,b/db` names two) and
// no host / hostaddr / service parameter can point elsewhere.
function dbUrlIsLocal(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (['host', 'hostaddr', 'service'].some((k) => u.searchParams.has(k))) return false;
  return u.hostname.split(',').every((h) => LOCAL_HOSTS.has(h.replace(/:\d+$/, '')));
}

// --linked (not =false), or a --db-url that isn't local.
function targetsRemote(args) {
  if (args.flags.some((w) => w === '--linked' || (w.startsWith('--linked=') && w !== '--linked=false'))) return true;
  return args.values(['--db-url']).some((u) => !dbUrlIsLocal(u));
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
  try { st = lstatSync(full); } catch { return { why: `the -f file is missing (${path})` }; }
  if (st.isSymbolicLink() || (st.isFile() && st.nlink > 1)) return { why: 'the -f file is a link, so another name can change it' };
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

// A command that may run before ctx.commands[k] and write a file: a
// top-level command before it (any, for a nested k), or a nested one anywhere
// — a substitution, even in the query's own words, runs first. It's a writer
// unless it is SAFE_BEFORE by its bare name, with no output redirection.
function writerBefore(ctx, k) {
  const query = ctx.commands[k];
  const before = ctx.commands.filter((w, j) => j !== k && (w.depth > 0 || query.depth > 0 || j < k));
  return before.find((w) => {
    if (w.every((x) => /^[A-Za-z_]\w*=/.test(x))) return false;
    if (w.some((x, j) => !w.quoted[j] && /^\d*(?:>|>>|&>|>\|)/.test(x) && !/^\d*>&\d$/.test(x))) return true;
    return w[0].includes('/') || !SAFE_BEFORE.has(w[0]);
  });
}

function judgeQuery(words, i, args, ctx, k) {
  const what = 'supabase db query';
  const { positionals } = args;
  const pg = words.slice(0, i).find((w) => /^PG[A-Z_]+=/.test(w));
  if (pg) return unclear(what, `it sets ${pg.split('=')[0]}`);
  const rest = words.slice(i + 1);
  const files = args.values(['-f', '--file']);
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
  if (file.why) return unclear(what, file.why);
  const writer = writerBefore(ctx, k);
  if (writer) return unclear(what, `\`${writer.slice(0, 3).join(' ')}\` runs before it in this call and may change the file`);
  return judgeSql(file.sql, what, ctx);
}

// ctx.commands[k] has a `supabase` word at i → a verdict, or null.
function judgeCli(words, i, ctx, k) {
  const args = parseArgs(words.slice(i + 1));
  const { positionals, flags } = args;
  if (flags.includes('--help') || flags.includes('-h') || positionals[0] === 'help') return null;
  if (flags.includes('--local')) return null;
  const p = ` ${positionals.join(' ')} `;
  const has = (s) => p.includes(` ${s} `);
  const remote = targetsRemote(args);
  if (has('db push')) return flags.includes('--dry-run') ? null : writes('supabase db push');
  if (has('db query')) return remote ? judgeQuery(words, i, args, ctx, k) : null;
  if (has('db reset')) return remote ? writes('supabase db reset (remote)') : null;
  if (has('db pull')) return unclear('supabase db pull', 'it may update the remote migration history');
  for (const dir of ['up', 'down']) if (has(`migration ${dir}`)) return remote ? writes(`supabase migration ${dir} (remote)`) : null;
  for (const s of ['migration repair', 'functions deploy', 'functions delete', 'config push', 'secrets set',
    'secrets unset', 'storage rm', 'storage mv']) if (has(s)) return writes(`supabase ${s}`);
  const cp = positionals.findIndex((w, j) => w === 'cp' && positionals[j - 1] === 'storage');
  if (cp >= 0) return positionals.slice(cp + 2).some((w) => w.startsWith('ss://')) ? writes('supabase storage cp (an upload)') : null;
  if (MANAGEMENT.has(positionals[0]) && WRITE_VERBS.has(positionals[1])) return writes(`supabase ${positionals[0]} ${positionals[1]}`);
  const flagged = remote || args.values(['--project-ref']).length > 0;
  if (flagged && !READ_GROUPS.has(positionals[0]) && !READ_VERBS.has(positionals[1])) {
    return unclear(`supabase ${positionals.slice(0, 2).join(' ')}`.trim(), "it targets the remote project, and isn't a known read");
  }
  return null;
}

// ── HTTP ───────────────────────────────────────────────────────────────────
const isSupabaseHost = (h) => /(^|\.)supabase\.(co|com)$/i.test(String(h ?? ''));
// The hosts of the URLs (or bare api.supabase.com / *.supabase.co paths) in a
// word; a fully qualified name's trailing dot is dropped.
function hostsIn(word) {
  const out = [];
  for (const m of String(word).matchAll(/(?:\b[a-z][a-z0-9+.-]*:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})\.?(?=[/:?#'"\s]|$)/gi)) out.push(m[1]);
  return out;
}
// A word the shell or curl would expand before it's a URL: a variable, a
// substitution, or curl's {a,b} / [1-3] globbing.
const nonLiteral = (w) => /[$`{}[\]]/.test(w);
const INTERPRETER = /^(?:node|nodejs|deno|bun|tsx|ts-node|python|pypy|ruby|perl|php|osascript)[\d.]*$/;
// curl's long options that send a body, and its short options that take a
// value (the rest of the word, or the next one).
const CURL_DATA = ['--data', '--data-binary', '--data-raw', '--data-urlencode', '--data-ascii', '--json', '--form',
  '--form-string', '--upload-file'];
const CURL_SHORT_VALUE = new Set('AbBcCdDeEFHKmoPQrtTuUwxXyYz'.split(''));
const WGET_DATA = ['--post-data', '--post-file', '--body-data', '--body-file'];
const isLong = (w, opts) => opts.some((f) => w === f || w.startsWith(`${f}=`));

// → { method, config }: the HTTP method a curl / wget call sends, and
// whether curl reads a config file (-K), which can set any of it.
function httpCall(tool, rest) {
  let method = '';
  let data = false;
  let head = false;
  let get = false;
  let config = false;
  for (let k = 0; k < rest.length; k++) {
    const w = rest[k];
    if (tool === 'wget') {
      if (w === '--method') method = rest[++k] ?? '';
      else if (w.startsWith('--method=')) method = w.slice(9);
      else if (isLong(w, WGET_DATA)) data = true;
      continue;
    }
    if (w === '--request') method = rest[++k] ?? '';
    else if (w.startsWith('--request=')) method = w.slice(10);
    else if (isLong(w, CURL_DATA)) data = true;
    else if (isLong(w, ['--config'])) config = true;
    else if (w === '--head') head = true;
    else if (w === '--get') get = true;
    else if (/^-[^-]/.test(w)) {
      for (let j = 1; j < w.length; j++) {
        const c = w[j];
        if (c === 'I') head = true;
        else if (c === 'G') get = true;
        if (!CURL_SHORT_VALUE.has(c)) continue;
        const value = w.slice(j + 1) || rest[++k] || '';
        if (c === 'X') method = value;
        else if (c === 'd' || c === 'F' || c === 'T') data = true;
        else if (c === 'K') config = true;
        break;
      }
    }
  }
  const m = method ? method.toUpperCase() : get ? 'GET' : head ? 'HEAD' : data ? 'POST' : 'GET';
  return { method: m, config };
}

function judgeHttp(words, i) {
  const tool = base(words[i]);
  const rest = words.slice(i + 1);
  const { method, config } = httpCall(tool, rest);
  const named = rest.filter(mentions);
  if (config && named.length) return unclear(tool, 'it reads a config file (-K), which can set the method');
  if (method === 'GET' || method === 'HEAD') return null;
  if (/\$/.test(method) && named.length) return unclear(`${tool} ${method}`, "its method isn't literal");
  if (named.some(nonLiteral)) return unclear(`${tool} ${method}`, "a URL naming supabase isn't literal");
  const host = rest.flatMap(hostsIn).find(isSupabaseHost);
  if (host) return writes(`${tool} ${method} ${host}`);
  if (named.length) return unclear(`${tool} ${method}`, "it names supabase in a URL it can't read");
  return null;
}

// ── psql ───────────────────────────────────────────────────────────────────
const PSQL_VALUE = new Set(['-h', '--host', '-p', '--port', '-U', '--username', '-d', '--dbname', '-c', '--command',
  '-f', '--file', '-v', '--variable', '--set', '-o', '--output', '-P', '--pset', '-L', '--log-file', '-T', '-F', '-R']);
// PG* variables that only carry credentials or the target; any other (PGOPTIONS,
// PGSERVICE, PGCLIENTENCODING …) can change what a read does or where it goes.
const PG_PLAIN = new Set(['PGPASSWORD', 'PGUSER', 'PGPORT', 'PGHOST', 'PGDATABASE', 'PGSSLMODE', 'PGCONNECT_TIMEOUT', 'PGAPPNAME']);

// A connection target → { hosts, service }: every host a URI or conninfo
// names (a comma list, host= / hostaddr= parameters), or the word itself.
function targetHosts(target) {
  const t = String(target);
  if (/^postgres(?:ql)?:\/\//i.test(t)) {
    let u;
    try { u = new URL(t); } catch { return { hosts: [t], service: false }; }
    const hosts = [...u.hostname.split(','), ...u.searchParams.getAll('host').flatMap((h) => h.split(',')), ...u.searchParams.getAll('hostaddr')];
    return { hosts: hosts.map((h) => h.replace(/:\d+$/, '')), service: u.searchParams.has('service') };
  }
  if (/(?:^|\s)(?:host|hostaddr|service)=/.test(t)) {
    const hosts = [...t.matchAll(/(?:^|\s)(?:host|hostaddr)=(\S+)/g)].flatMap((m) => m[1].split(','));
    return { hosts, service: /(?:^|\s)service=/.test(t) };
  }
  return { hosts: [t], service: false };
}

function judgePsql(words, i, ctx) {
  const tool = base(words[i]);
  const rest = words.slice(i + 1);
  const targets = [...values(rest, ['-h', '--host', '-d', '--dbname'])];
  for (const w of words.slice(0, i)) if (/^PGHOST=/.test(w)) targets.push(w.slice(7));
  for (let k = 0; k < rest.length; k++) {
    const w = rest[k];
    if (PSQL_VALUE.has(w)) { k++; continue; }
    if (/^-[hd]./.test(w)) { targets.push(w.slice(2)); continue; } // -hHOST, -dDBNAME
    if (w.startsWith('-')) { if (mentions(w)) targets.push(w); continue; }
    if (/^\d*[<>]/.test(w)) continue;
    targets.push(w); // the dbname (a URL or conninfo) or the user name
  }
  if (targets.some((t) => t.includes('$'))) return unclear(tool, "its target isn't literal");
  const parsed = targets.map(targetHosts);
  if (parsed.some((t) => t.service)) return unclear(tool, 'it names a connection service, which can point anywhere');
  const host = parsed.flatMap((t) => t.hosts).find((h) => isSupabaseHost(h) || (mentions(h) && /[/@:]/.test(h)));
  if (!host) return null;
  if (tool === 'pg_dump' || tool === 'pg_dumpall') return null;
  if (tool === 'pg_restore') return writes(`pg_restore to ${host}`);
  const pg = words.slice(0, i).find((w) => /^PG[A-Z_]+=/.test(w) && !PG_PLAIN.has(w.split('=')[0]));
  if (pg) return unclear(tool, `it sets ${pg.split('=')[0]}`);
  const commands = values(rest, ['-c', '--command']);
  const files = values(rest, ['-f', '--file']);
  if (!commands.length && !files.length) return unclear(tool, 'it reads SQL interactively or from stdin');
  const verdicts = [];
  for (const sql of commands) {
    verdicts.push(/`|\$[({A-Za-z_]/.test(sql) ? unclear(tool, "the -c SQL isn't literal") : judgeSql(sql, tool, ctx));
  }
  for (const f of files) {
    const file = readSqlFile(f, ctx);
    verdicts.push(file.why ? unclear(tool, file.why) : judgeSql(file.sql, tool, ctx));
  }
  return verdicts.find((v) => v?.kind === 'writes') ?? verdicts.find(Boolean) ?? null;
}

export function judgeShell(ctx) {
  const out = [];
  for (const [k, words] of ctx.commands.entries()) {
    const i = words.findIndex(isCli);
    const v = i >= 0 ? judgeCli(words, i, ctx, k) : null;
    if (v) out.push(v);
    const h = words.findIndex((w) => ['curl', 'wget'].includes(base(w)));
    const hv = h >= 0 ? judgeHttp(words, h) : null;
    if (hv) out.push(hv);
    const p = words.findIndex((w) => ['psql', 'pg_dump', 'pg_dumpall', 'pg_restore'].includes(base(w)));
    const pv = p >= 0 ? judgePsql(words, p, ctx) : null;
    if (pv) out.push(pv);
    const n = words.findIndex((w) => INTERPRETER.test(base(w)));
    if (n >= 0 && words.slice(n + 1).some((w) => hostsIn(w).some(isSupabaseHost))) {
      out.push(unclear(base(words[n]), 'it calls a Supabase API host from a script'));
    }
  }
  if (ctx.unparsed.some(mentions)) out.push(unclear('a command naming supabase', "it can't be parsed"));
  return out;
}

// ── MCP ────────────────────────────────────────────────────────────────────
const list = (s) => new Set(s.trim().split(/\s+/));
export const READ_TOOLS = list(`confirm_cost generate_typescript_types get_advisors get_anon_key get_cost
  get_edge_function get_logs get_organization get_project get_project_url get_publishable_keys get_storage_config
  list_branches list_edge_functions list_extensions list_migrations list_organizations list_projects
  list_storage_buckets list_tables query_logs search_docs`);
export const SUPABASE_ONLY_TOOLS = list(`apply_migration execute_sql deploy_edge_function create_branch delete_branch
  merge_branch reset_branch rebase_branch list_branches list_migrations list_extensions list_tables
  list_edge_functions get_edge_function generate_typescript_types get_advisors get_publishable_keys get_anon_key
  get_project_url confirm_cost get_cost list_storage_buckets get_storage_config update_storage_config`);
const NAMED_WRITES = list(`apply_migration deploy_edge_function merge_branch reset_branch rebase_branch create_branch
  delete_branch pause_project restore_project create_project update_storage_config`);
const PROJECT_REF = /^[a-z]{20}$/;

function isSupabaseCall(call) {
  if (/supabase/i.test(call.server)) return true;
  try { if (isSupabaseHost(new URL(call.url).hostname)) return true; } catch { /* no URL */ }
  if (SUPABASE_ONLY_TOOLS.has(call.tool)) return true;
  // Supabase's own field names: create_project takes organization_id and confirm_cost_id.
  if (call.input && (Object.hasOwn(call.input, 'organization_id') || Object.hasOwn(call.input, 'confirm_cost_id'))) return true;
  return typeof call.input?.project_id === 'string' && PROJECT_REF.test(call.input.project_id);
}

export function judgeMcp(call, ctx) {
  if (!isSupabaseCall(call) || READ_TOOLS.has(call.tool)) return null;
  const what = `MCP ${call.tool}`;
  if (call.tool === 'execute_sql') {
    const q = call.input?.query;
    return typeof q === 'string' ? judgeSql(q, what, ctx) : unclear(what, 'no query');
  }
  if (NAMED_WRITES.has(call.tool)) return writes(what);
  return unclear(what, "it isn't one of Supabase's known read tools");
}
