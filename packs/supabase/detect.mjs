// Does a repo use Supabase? Run by `bin/ssdd.mjs install` (and `status`) from
// the release being installed. → the evidence ('supabase/config.toml',
// 'package.json: @supabase/supabase-js', 'package.json: supabase'), or ''.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function detect(root) {
  if (existsSync(join(root, 'supabase', 'config.toml'))) return 'supabase/config.toml';
  let pkg = null;
  try { pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')); } catch { return ''; }
  for (const dep of ['@supabase/supabase-js', 'supabase']) {
    for (const field of ['dependencies', 'devDependencies']) {
      if (pkg?.[field] && typeof pkg[field] === 'object' && Object.hasOwn(pkg[field], dep)) return `package.json: ${dep}`;
    }
  }
  return '';
}
