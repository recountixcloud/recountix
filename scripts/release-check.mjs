import fs from "node:fs";
import path from "node:path";

const fail = message => { console.error("RELEASE:", message); process.exitCode = 1; };
const read = file => fs.readFileSync(file, "utf8");
const version = "Rc.0.05";

const app = read("frontend/js/app.js");
const settings = read("frontend/settings.html");
const company = JSON.parse(read("config/company.json"));
if (!app.includes(`version: "${version}"`)) fail("APP_INFO version mismatch");
if (!settings.includes(version)) fail("Settings version mismatch");
if (company.version !== version) fail("company.json version mismatch");

const auth = read("frontend/js/auth.js");
for (const required of ["app_login", "app_validate_session", "Secure login service is unavailable", "clearSession"]) {
  if (!auth.includes(required)) fail(`auth fail-closed control missing: ${required}`);
}

const offline = read("frontend/js/offline-backup.js");
for (const required of ["navigator.onLine", 'addEventListener("online"', "lastFailureAt", "AES-GCM", "PBKDF2"]) {
  if (!offline.includes(required)) fail(`offline error/retry control missing: ${required}`);
}

const restore = read("frontend/js/backup.js");
for (const required of ["This backup belongs to another business", "Wrong backup password or damaged file", "Internet is required to restore"]) {
  if (!restore.includes(required)) fail(`restore validation missing: ${required}`);
}

const htmlFiles = fs.readdirSync("frontend").filter(name => name.endsWith(".html"));
for (const name of htmlFiles) {
  const text = read(path.join("frontend", name));
  if (!text.includes("Content-Security-Policy")) fail(`CSP missing: ${name}`);
}

if (!process.exitCode) console.log(`Release checks passed for ${version}.`);
