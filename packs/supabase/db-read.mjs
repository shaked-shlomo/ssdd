#!/usr/bin/env node
// db-read — the read path to the production database that never asks.
//
//   node .ssdd/packs/supabase/db-read.mjs [--personal] [-o json|table|csv] [--workdir <dir>] "<sql>"
//
// Wraps the SQL in BEGIN READ ONLY; … ROLLBACK;, so Postgres refuses any
// write, and runs the pack's classifier on the wrapped text before anything
// runs: SQL that isn't a read (a COMMIT that breaks out, a write, a call the
// classifier can't vouch for) is refused with exit 2. A read is written to a
// private temp file and run as `supabase db query --linked -f <file>`; the
// file is removed after, and the CLI's exit status is returned.
//
// productionGuard.supabase.personalReads (in the repo's .ssdd/config.json)
// applies: a read naming one of those tables or columns is refused unless
// --personal is given, and prod-guard asks the owner before that call.
// The CLI is `supabase` on PATH, or SSDD_SUPABASE_BIN.
//
// It reads the config through the hooks' ssdd-config.mjs, which sits in
// ../../hooks once installed and ../../mechanisms/hooks in SSDD's own tree.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { classifySql } from './sql-readonly.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fail = (msg) => { process.stderr.write(`db-read: ${msg}\n`); process.exit(2); };

async function options() {
  const lib = [join(here, '..', '..', 'hooks', 'ssdd-config.mjs'), join(here, '..', '..', 'mechanisms', 'hooks', 'ssdd-config.mjs')]
    .find(existsSync);
  if (!lib) return {};
  const { loadSsddConfig } = await import(pathToFileURL(lib).href);
  const loaded = loadSsddConfig(process.cwd());
  if (loaded?.sectionErrors?.productionGuard) fail(`refused — ${loaded.sectionErrors.productionGuard}`);
  return loaded?.cfg?.productionGuard?.supabase ?? {};
}

const argv = process.argv.slice(2);
let personal = false;
const pass = [];
const sqls = [];
for (let k = 0; k < argv.length; k++) {
  const a = argv[k];
  if (a === '--personal') personal = true;
  else if (a === '-o' || a === '--output' || a === '--workdir') pass.push(a, argv[++k] ?? '');
  else sqls.push(a);
}
if (sqls.length !== 1 || !sqls[0].trim()) {
  fail('usage: db-read.mjs [--personal] [-o json|table|csv] [--workdir <dir>] "<sql>"');
}

const wrapped = `BEGIN READ ONLY;\n${sqls[0].trim().replace(/;*\s*$/, ';')}\nROLLBACK;\n`;
const verdict = classifySql(wrapped, await options());
if (verdict.verdict !== 'read' || verdict.rule !== 'read-only transaction') {
  fail(`refused, nothing ran — ${verdict.verdict === 'writes' ? `it writes (${verdict.rule})` : verdict.rule}`);
}
if (verdict.personal && !personal) {
  fail(`refused, nothing ran — it reads personal data (${verdict.personal.join(', ')}). Ask the owner, then run it with --personal.`);
}

const dir = mkdtempSync(join(tmpdir(), 'ssdd-db-read-'));
let status = 1;
try {
  const file = join(dir, 'query.sql');
  writeFileSync(file, wrapped, { mode: 0o600 });
  const r = spawnSync(process.env.SSDD_SUPABASE_BIN || 'supabase', ['db', 'query', '--linked', '-f', file, ...pass], { stdio: 'inherit' });
  if (r.error) process.stderr.write(`db-read: can't run the Supabase CLI (${r.error.message})\n`);
  status = r.status ?? 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exit(status);
