import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const runtimeFiles = walk("frontend").filter(file => /\.(?:js|html)$/.test(file));
let failed = false;
for (const file of runtimeFiles) {
  const text = fs.readFileSync(file, "utf8");
  // The pinned upstream SDK defines table/key APIs; app-only pattern rules
  // do not apply to its implementation. Verify the exact bundle instead.
  if (file === "frontend/js/vendor/supabase-2.117.2.js") {
    const digest = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    if (digest !== "2eebfe06b1b5309985dc1526e8981ea3a18b71beeef83e7f38e04c303e142d6d") {
      console.error("SECURITY: pinned Supabase SDK integrity mismatch");
      failed = true;
    }
    continue;
  }
  const withoutArrayFrom = text.replaceAll("Array.from(", "");
  if (/\.from\s*\(/.test(withoutArrayFrom)) {
    console.error(`SECURITY: direct Supabase table access found in ${file}`);
    failed = true;
  }
  if (/service[_-]?role|sb_secret_/i.test(text)) {
    console.error(`SECURITY: privileged Supabase key marker found in ${file}`);
    failed = true;
  }
  if (file.endsWith(".html") && !text.includes("Content-Security-Policy")) {
    console.error(`SECURITY: Content Security Policy missing in ${file}`);
    failed = true;
  }
}

const supabaseClient = fs.readFileSync("frontend/js/supabase.js", "utf8");
if (!/sb_publishable_[A-Za-z0-9_-]+/.test(supabaseClient)) {
  console.error("SECURITY: frontend must use a Supabase publishable key");
  failed = true;
}

const auth = fs.readFileSync("frontend/js/auth.js", "utf8");
if (/PASSWORD_PEPPER|fallback_["']?\s*\+|function\s+hashPassword/.test(auth)) {
  console.error("SECURITY: client-side password hashing fallback found");
  failed = true;
}

const sqlFiles = walk("database").filter(file => file.endsWith(".sql"));
for (const file of sqlFiles) {
  const raw = fs.readFileSync(file, "utf8");
  const text = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
  if (/create\s+policy[\s\S]{0,300}using\s*\(\s*true\s*\)/i.test(text)) {
    console.error(`SECURITY: permissive open RLS policy found in ${file}`);
    failed = true;
  }
  if (/grant\s+all[\s\S]{0,120}\b(?:anon|authenticated)\b/i.test(text)) {
    console.error(`SECURITY: direct broad table grant found in ${file}`);
    failed = true;
  }
}

const readme = fs.readFileSync("README.md", "utf8");
if (/superadmin\s*\|\s*1234/i.test(readme) || /login as\s+`?superadmin`?\s*\/\s*`?1234/i.test(readme)) {
  console.error("SECURITY: published default Super Admin credentials found in README.md");
  failed = true;
}

const migration = fs.readFileSync("database/security_foundation.sql", "utf8");
for (const required of ["app_validate_session","app_login","app_get_customers","app_save_recovery","FINAL LOCKDOWN","revoke all on table"]) {
  if (!migration.includes(required)) {
    console.error(`SECURITY: migration missing required control: ${required}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log(`Security regression checks passed for ${runtimeFiles.length} runtime files.`);
