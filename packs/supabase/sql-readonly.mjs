// The Supabase pack's SQL classifier: what a script would do to the
// production database. Ported from the source project's supabase-guard
// (lib/sql-readonly.mjs), with Part 4's changes (SPEC v3 Part 4, Clarify
// 32–33): a static read passes without READ ONLY, writes are named, every
// verdict carries the rule that decided it, and the proof frame and the live
// extensions come from the project's config.
//
//   classifySql(raw, opts) → { verdict, rule, personal? }
//     verdict 'read'    — rule 'read-only transaction' (BEGIN READ ONLY …
//                         ROLLBACK) or 'static read' (only SELECT / WITH /
//                         TABLE / VALUES / SHOW / EXPLAIN statements,
//                         optionally inside one BEGIN … ROLLBACK|COMMIT that
//                         isn't READ WRITE)
//             'proof'   — rule 'proof frame': the file is exactly
//                         opts.proofFrame's prologue + body + epilogue, the
//                         body can't loosen the frame's timeouts, and nothing
//                         reaches out of band
//             'writes'  — rule '<KIND> statement', 'rolled back <KIND>
//                         statement' inside a BEGIN … ROLLBACK, 'WITH … DELETE
//                         statement', 'SELECT INTO statement'
//             'unclear' — rule says why (e.g. 'names client_encoding', 'calls
//                         public.f', 'SET statement', 'unterminated string',
//                         'proof frame not configured', 'no statements')
//     personal — for a read or a proof, the opts.personalReads tables and
//                columns it names (outside strings and comments)
//   opts = { proofFrame?: { prologue: string[], epilogue: string[] },
//            liveExtensions?: string[], personalReads?: { tables?, columns? } }
//
// Both read rules refuse, anywhere in the file: `U&` (Unicode escapes can
// spell any name), standard_conforming_strings / transaction_read_only /
// client_encoding and SET NAMES (they change how the server lexes or runs the
// rest), `set_config`, a string-bodied DO / CREATE FUNCTION … AS '…', and an
// out-of-band name (dblink*, pg_terminate_backend, COPY / PROGRAM, http_*
// except pg_net's enqueue functions qualified by `net` …). A read may call
// only the allowlisted read-only builtins below, information_schema.*, and
// auth.uid / role / jwt.
//
// Known residue (an accident guard, not a security boundary): a read without
// READ ONLY can still write through a view or an RLS policy that calls a
// writing function; a user function called inside a proof can reach out of
// band without naming it here; an allowlisted builtin can be shadowed by a
// more specific user overload; a `t.f` attribute call has no `(`.
import { IDENT_START, lexSql } from './sql-lex.mjs';

const TOKEN = /[A-Za-z_\u0080-￿][A-Za-z0-9_$\u0080-￿]*|\$\d+|\d+|\S/g;
const isIdent = (t) => t !== undefined && IDENT_START.test(t[0]);
const words = (list) => list.trim().split(/\s+/);
const wordRe = (list) => new RegExp(`(?<![A-Za-z0-9_$])(?:${words(list).join('|')})(?![A-Za-z0-9_$])`, 'i');

// The three settings a proof frame bounds (regex source, unanchored).
export const TIMEOUTS = '(?:lock_timeout|statement_timeout|idle_in_transaction_session_timeout)';

const TXN_FIRST = new Set(words('BEGIN START COMMIT END ROLLBACK ABORT SAVEPOINT RELEASE'));
const isTxnControl = (t) => TXN_FIRST.has(t[0]) || (t[0] === 'PREPARE' && t[1] === 'TRANSACTION');
// Proof statements refused outright: COPY / LOAD reach the server's files;
// ANALYZE rewrites pg_class row-count stats in place, which ROLLBACK doesn't undo.
const PROOF_REFUSED = new Set(words('COPY LOAD ANALYZE ANALYSE'));
const OUT_OF_BAND_NAMES = wordRe(String.raw`dblink\w* pg_terminate_backend pg_cancel_backend
  pg_reload_conf pg_rotate_logfile pg_promote pg_switch_wal pg_create_restore_point pg_create_\w*slot\w*
  pg_\w*replication_slot\w* pg_replication_origin_\w+ pg_stat\w*_reset\w* pg_file_\w+ pg_read_\w*file\w*
  pg_ls_\w+ lo_\w+ pg_backup_\w+ pg_logical_\w+ worker_restart PROGRAM COPY SUBSCRIPTION`);
// Every `http` / `http_*` word (the sync `http` extension) is out of band
// unless it's a pg_net name qualified by exactly `net` / `"net"`: pg_net only
// enqueues, and its worker sends after COMMIT, which a proof never reaches.
const NON_IDENT = '[^A-Za-z0-9_$\u0080-￿]';
const HTTP_WORD = new RegExp(`(?<=^|${NON_IDENT})"?http(?:_[A-Za-z0-9_$]*)?"?(?=$|${NON_IDENT})`, 'gi');
const NET_QUALIFIER = new RegExp(String.raw`(?:^|[^A-Za-z0-9_$\u0080-￿".])(?:[Nn][Ee][Tt]|"net")\s*\.\s*$`);
const NET_OK = new Set(words('http_get http_post http_delete http_request_queue http_collect_response'));
const netName = (w) => NET_OK.has(w.startsWith('"') ? w.slice(1, -1) : w.toLowerCase());
const outOfBand = (s) => OUT_OF_BAND_NAMES.exec(s)?.[0] ||
  [...s.matchAll(HTTP_WORD)].find((m) => !(netName(m[0]) && NET_QUALIFIER.test(s.slice(0, m.index))))?.[0] || '';
const STRING_AS_SQL = wordRe(String.raw`query_to_xml\w* cursor_to_xml\w* ts_stat ts_rewrite crosstab\w* connectby
  xpath_table`);
// DDL whose definition list may name a FUNCTION as a string: that statement's strings count.
const STRING_AS_FUNCTION = /\b(?:CREATE|ALTER)\s+(?:OR\s+REPLACE\s+)?(?:AGGREGATE|OPERATOR|TYPE|TEXT\s+SEARCH|CAST|CONVERSION|COLLATION|LANGUAGE|ACCESS\s+METHOD|FOREIGN|SERVER|EVENT\s+TRIGGER|STATISTICS)\b/i;
// A string → function cast in any spelling: every string in the file counts.
const REGPROC = /regproc/i;
// A plain-string body runs as code and dodges the strings-are-data scan.
const STRING_BODY = /\b(?:AS|DO(?:\s+LANGUAGE\s+\S+)?)\s+__STR__/i;
const CREATE_EXTENSION = /\bCREATE\s+EXTENSION\b/gi;
const EXTENSION_NAME = /^\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_$]*))(?=[\s;]|$)/i;
const LEX_MODE = /standard_conforming_strings|transaction_read_only|client_encoding/i;
const SET_NAMES = /\bSET\s+(?:SESSION\s+|LOCAL\s+)?NAMES\b/i;
const EXECUTE = wordRe('EXECUTE');

// What the out-of-band scan reads: `names`, with string contents restored
// file-wide (STRING_AS_SQL, REGPROC) or per statement (STRING_AS_FUNCTION).
function scanText({ lits, names, ends }) {
  if (STRING_AS_SQL.test(names) || REGPROC.test(names)) return lits;
  const out = [];
  let [l0, n0] = [0, 0];
  for (const [l1, n1] of [...ends, [lits.length, names.length]]) {
    const stmt = names.slice(n0, n1);
    out.push(STRING_AS_FUNCTION.test(stmt) ? lits.slice(l0, l1) : stmt);
    [l0, n0] = [l1 + 1, n1 + 1];
  }
  return out.join(';');
}

// '' when every CREATE EXTENSION names a live extension and nothing ALTERs one.
function extensionRefusal(names, live) {
  if (/\bALTER\s+EXTENSION\b/i.test(names)) return 'ALTER EXTENSION';
  for (const m of names.matchAll(CREATE_EXTENSION)) {
    const n = EXTENSION_NAME.exec(names.slice(m.index + m[0].length));
    const name = n && (n[1] ?? n[2].toLowerCase());
    if (!name || !live.has(name)) return `CREATE EXTENSION ${name ?? '(unreadable name)'}, which isn't in liveExtensions`;
  }
  return '';
}

// Refusals that apply to every read and proof rule → why, or ''.
function refusal(raw, names, live) {
  if (/u&/i.test(raw)) return 'U& escapes';
  const lex = LEX_MODE.exec(raw);
  if (lex) return `names ${lex[0].toLowerCase()}`;
  if (SET_NAMES.test(names)) return 'SET NAMES';
  if (STRING_BODY.test(names)) return 'a string-bodied function or DO block';
  return extensionRefusal(names, live);
}

// ── the proof frame (project config) ──────────────────────────────────────
// The file is prologue + middle + epilogue (trailing newlines aside), and the
// middle can't loosen the prologue's timeouts or swallow the epilogue.
function framed(raw, frame) {
  const head = frame.prologue.join('\n') + '\n';
  const tail = '\n' + frame.epilogue.join('\n');
  const body = raw.replace(/\n+$/, '');
  if (!body.startsWith(head) || !body.endsWith(tail) || body.length < head.length + tail.length) return false;
  const mid = lexSql(body.slice(head.length, body.length - tail.length));
  if (mid.open || !/;\s*$/.test(mid.code)) return false;
  const lits = mid.lits.replace(/"/g, '');
  if (new RegExp(TIMEOUTS, 'i').test(lits) || /\bRESET\s+ALL\b/i.test(lits) || /\bpg_settings\b/i.test(lits)) return false;
  for (const m of lits.matchAll(/\bset_config\s*\(\s*('(?:[^']|'')*'(?=\s*,))?/gi)) if (!m[1]) return false;
  return true;
}

// BEGIN [WORK|TRANSACTION] / START TRANSACTION + modes → { ok, readOnly },
// or null when t isn't a begin. READ WRITE or an unknown mode → ok false.
function beginModes(t) {
  let i;
  if (t[0] === 'BEGIN') i = t[1] === 'WORK' || t[1] === 'TRANSACTION' ? 2 : 1;
  else if (t[0] === 'START' && t[1] === 'TRANSACTION') i = 2;
  else return null;
  let readOnly = false;
  while (i < t.length) {
    const [a, b, c] = [t[i], t[i + 1], t[i + 2]];
    if (a === ',') i++;
    else if (a === 'READ' && b === 'ONLY') { readOnly = true; i += 2; }
    else if (a === 'DEFERRABLE') i++;
    else if (a === 'NOT' && b === 'DEFERRABLE') i += 2;
    else if (a === 'ISOLATION' && b === 'LEVEL') {
      if (c === 'SERIALIZABLE') i += 3;
      else if ((c === 'REPEATABLE' && t[i + 3] === 'READ') ||
        (c === 'READ' && (t[i + 3] === 'COMMITTED' || t[i + 3] === 'UNCOMMITTED'))) i += 4;
      else return { ok: false, readOnly };
    } else return { ok: false, readOnly };
  }
  return { ok: true, readOnly };
}
const isEnd = (t) => ['ROLLBACK', 'COMMIT', 'END', 'ABORT'].includes(t[0]) &&
  (t.length === 1 || (t.length === 2 && (t[1] === 'WORK' || t[1] === 'TRANSACTION')));

// ── statement and call rules ──────────────────────────────────────────────
const RO_FIRST = new Set(words('SELECT WITH TABLE VALUES SHOW EXPLAIN'));
const FORBIDDEN = wordRe(`INSERT UPDATE DELETE MERGE TRUNCATE CREATE ALTER DROP GRANT REVOKE COPY CALL DO LOCK
  VACUUM ANALYZE ANALYSE CLUSTER REINDEX REFRESH COMMENT SECURITY IMPORT INTO NOTIFY LISTEN PREPARE EXECUTE
  DEALLOCATE DISCARD RESET SET BEGIN START COMMIT ROLLBACK SAVEPOINT RELEASE SHARE CHECKPOINT`);
const WRITE_FIRST = new Set(words(`INSERT UPDATE DELETE MERGE TRUNCATE CREATE ALTER DROP GRANT REVOKE COMMENT COPY
  CALL DO LOCK VACUUM ANALYZE ANALYSE CLUSTER REINDEX REFRESH SECURITY IMPORT REASSIGN NOTIFY`));
const CTE_WRITES = new Set(words('INSERT UPDATE DELETE MERGE'));
// RESERVED / col_name keywords that may precede `(` without being a call.
// Unreserved keywords (BY, JOIN, EXPLAIN, FILTER, OVER …) CAN name a function,
// so they count as calls — except FILTER / OVER right after `)`.
const PAREN_KEYWORDS = new Set(words(`IN ANY ALL SOME EXISTS ARRAY ROW VALUES AS AND OR NOT FROM ON WHERE
  SELECT CAST COALESCE NULLIF GREATEST LEAST EXTRACT POSITION SUBSTRING TRIM OVERLAY CASE WHEN THEN ELSE
  USING LIMIT OFFSET HAVING UNION INTERSECT EXCEPT LATERAL DISTINCT GROUP`));
// Read-only builtins: aggregates, lookups and pure computation. The last
// lines are Part 4's additions from the replay corpora (catalog lookups and
// math functions; each looks up or computes, per the Postgres docs).
const READ_ONLY_FNS = new Set(words(`count sum min max avg bool_and bool_or every array_agg string_agg json_agg
  jsonb_agg json_object_agg jsonb_object_agg json_build_object jsonb_build_object json_build_array
  jsonb_build_array to_json to_jsonb jsonb_typeof jsonb_array_length jsonb_pretty array_length
  array_to_string array_position array_remove cardinality unnest generate_series now current_date
  current_setting length char_length octet_length lower upper left right replace regexp_replace
  regexp_match split_part substr btrim ltrim rtrim concat concat_ws format to_char to_date to_timestamp
  date_trunc date_part age make_interval round floor ceil abs mod md5 encode decode string_to_array
  row_number rank dense_rank lag lead first_value last_value has_table_privilege has_column_privilege
  has_function_privilege has_schema_privilege has_sequence_privilege has_database_privilege
  has_any_column_privilege pg_has_role pg_get_userbyid pg_get_functiondef pg_get_function_identity_arguments
  pg_get_function_result pg_get_triggerdef pg_get_constraintdef pg_get_indexdef pg_get_viewdef pg_get_expr
  pg_get_serial_sequence pg_relation_size pg_total_relation_size pg_table_size pg_indexes_size
  pg_size_pretty pg_column_size pg_typeof obj_description col_description format_type quote_ident
  quote_literal version numeric decimal varchar char character bit varbit timestamp timestamptz time
  timetz interval float
  to_regprocedure to_regproc to_regclass to_regtype to_regnamespace to_regrole aclexplode acldefault
  enum_range power sqrt sin cos tan asin acos atan atan2 radians degrees ln log exp sign trunc
  percentile_cont percentile_disc jsonb_array_elements jsonb_array_elements_text regexp_matches vector_dims`));
const AUTH_FNS = new Set(['uid', 'role', 'jwt']);

// The first call t makes that a read may not, as written ('public.f', 'f'), or ''.
function badCall(t) {
  for (let k = 1; k < t.length; k++) {
    if (t[k] !== '(' || !isIdent(t[k - 1])) continue;
    const name = t[k - 1].toLowerCase();
    const upName = name.toUpperCase();
    if (t[k - 2] !== '.') {
      if (PAREN_KEYWORDS.has(upName) || READ_ONLY_FNS.has(name)) continue;
      if ((upName === 'FILTER' || upName === 'OVER') && t[k - 2] === ')') continue;
      // EXPLAIN's option list, and ORDER / GROUP / PARTITION BY (expr): keywords here, not calls.
      if (upName === 'EXPLAIN' && k === 1) continue;
      if (upName === 'BY' && ['ORDER', 'GROUP', 'PARTITION'].includes(String(t[k - 2]).toUpperCase())) continue;
      return t[k - 1];
    }
    if (!isIdent(t[k - 3]) || t[k - 4] === '.') return `${t[k - 3] ?? ''}.${t[k - 1]}`; // `(…).f(`, a.b.c(
    const schema = t[k - 3].toLowerCase();
    if (schema === 'information_schema') continue;
    if (schema === 'pg_catalog' && READ_ONLY_FNS.has(name)) continue;
    if (schema === 'auth' && AUTH_FNS.has(name)) continue;
    return `${t[k - 3]}.${t[k - 1]}`;
  }
  return '';
}

// The opts.personalReads names this SQL mentions, outside strings and comments.
function personalNames(names, personalReads) {
  const tables = Array.isArray(personalReads?.tables) ? personalReads.tables : [];
  const columns = Array.isArray(personalReads?.columns) ? personalReads.columns : [];
  if (!tables.length && !columns.length) return [];
  const toks = (names.match(/"(?:[^"]|"")*"|[A-Za-z_\u0080-￿][A-Za-z0-9_$\u0080-￿]*|\./g) ?? [])
    .map((t) => (t.startsWith('"') ? t.slice(1, -1).replace(/""/g, '"') : t.toLowerCase()));
  const has = (seq) => toks.some((_, i) => seq.every((p, j) => toks[i + j] === p));
  const out = [];
  for (const t of tables) {
    const parts = String(t).toLowerCase().split('.');
    if (has(parts.length === 2 ? [parts[0], '.', parts[1]] : [parts[0]])) out.push(t);
  }
  for (const c of columns) if (has([String(c).toLowerCase()])) out.push(c);
  return out;
}

const unclear = (rule) => ({ verdict: 'unclear', rule });

function classify(raw, opts) {
  const lexed = lexSql(raw);
  if (lexed.open) return unclear(`unterminated ${lexed.open}`);
  const { code, names, bodies } = lexed;
  const parts = code.split(';').filter((s) => /\S/.test(s));
  if (!parts.length) return unclear('no statements');
  const toks = parts.map((s) => s.match(TOKEN) ?? []);
  const up = toks.map((t) => t.map((x) => x.toUpperCase()));
  const last = up[up.length - 1];
  const live = new Set([...(Array.isArray(opts.liveExtensions) ? opts.liveExtensions : []), 'plpgsql']);
  const refused = refusal(raw, names, live);
  const scanned = scanText(lexed);
  const reaches = outOfBand(scanned);
  const withPersonal = (v) => {
    const personal = personalNames(names, opts.personalReads);
    return personal.length ? { ...v, personal } : v;
  };

  // A proof in the configured frame.
  const frame = opts.proofFrame;
  if (frame && !refused && framed(raw, frame) && up[0].join(' ') === 'BEGIN' && last.join(' ') === 'ROLLBACK' &&
      !reaches && !bodies.some((b) => EXECUTE.test(b)) &&
      up.slice(1, -1).every((t) => !isTxnControl(t) && !PROOF_REFUSED.has(t[0]))) {
    return withPersonal({ verdict: 'proof', rule: 'proof frame' });
  }

  // A read: optionally inside one BEGIN … end that isn't READ WRITE.
  const begin = beginModes(up[0]);
  let from = 0;
  let to = parts.length;
  if (begin) {
    from = 1;
    if (to - 1 > from && isEnd(last)) to--;
  }
  const inner = (a) => a.slice(from, to);
  const firstNonRead = inner(up).find((t) => !RO_FIRST.has(t[0]));
  const forbidden = inner(parts).map((s) => FORBIDDEN.exec(s)?.[0]).find(Boolean);
  const call = inner(toks).map(badCall).find(Boolean);
  if (!refused && !/set_config/i.test(raw) && !reaches && (!begin || begin.ok) && to > from &&
      !firstNonRead && !forbidden && !call) {
    const rule = begin?.readOnly && last[0] === 'ROLLBACK' && to < parts.length ? 'read-only transaction' : 'static read';
    return withPersonal({ verdict: 'read', rule });
  }

  // A proof the project hasn't configured: a BEGIN … ROLLBACK that sets timeouts.
  const timeouts = new RegExp(`^SET\\s+LOCAL\\s+"?${TIMEOUTS}`, 'i');
  if (!frame && up[0].join(' ') === 'BEGIN' && last.join(' ') === 'ROLLBACK' && parts.some((s) => timeouts.test(s.trim()))) {
    return unclear('proof frame not configured');
  }

  // Writes, named by their first statement.
  const rolledBack = Boolean(begin) && last[0] === 'ROLLBACK';
  for (const t of up.slice(begin ? 1 : 0)) {
    let kind = '';
    if (WRITE_FIRST.has(t[0])) kind = t[0];
    else if (t[0] === 'WITH') { const w = t.find((x) => CTE_WRITES.has(x)); if (w) kind = `WITH … ${w}`; }
    else if (t[0] === 'SELECT' && t.includes('INTO')) kind = 'SELECT INTO';
    if (kind) return { verdict: 'writes', rule: `${rolledBack ? 'rolled back ' : ''}${kind} statement` };
  }

  if (refused) return unclear(refused);
  if (/set_config/i.test(raw)) return unclear('calls set_config');
  if (reaches) return unclear(`names ${reaches}`);
  if (begin && !begin.ok) return unclear('a READ WRITE or unknown transaction mode');
  if (firstNonRead) return unclear(`${firstNonRead[0]} statement`);
  if (forbidden) return unclear(`${forbidden.toUpperCase()} in a read`);
  if (call) return unclear(`calls ${call}`);
  return unclear('no read statements');
}

export function classifySql(raw, opts = {}) {
  try {
    return classify(raw == null ? '' : String(raw), opts ?? {});
  } catch (e) {
    return unclear(`classifier error: ${e?.message ?? e}`);
  }
}

// Each top-level statement's leading keyword, upper case; a READ ONLY begin
// is kept whole ('BEGIN READ ONLY', 'START TRANSACTION READ ONLY').
export function statementKinds(raw) {
  try {
    const { code } = lexSql(raw == null ? '' : String(raw));
    return code.split(';').filter((s) => /\S/.test(s)).map((s) => {
      const t = (s.match(TOKEN) ?? []).map((x) => x.toUpperCase());
      const b = beginModes(t);
      if (b?.readOnly) return t[0] === 'START' ? 'START TRANSACTION READ ONLY' : 'BEGIN READ ONLY';
      return t[0] ?? '';
    });
  } catch {
    return [];
  }
}
