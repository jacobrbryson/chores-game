#!/usr/bin/env node
/**
 * Syncs shared packages into apps/web/packages and regenerates the apps/web
 * standalone lock file (without workspace context), then deploys.
 *
 * Run from the repo root: npm run deploy:web
 */
import { cpSync, renameSync, existsSync } from "fs";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const webDir = path.join(root, "apps", "web");
const embeddedPackageNames = ["core", "locales"];
const rootPkg = path.join(root, "package.json");
const rootPkgBak = path.join(root, "package.json.deploy-bak");

function run(cmd, cwd = root) {
  execSync(cmd, { cwd, stdio: "inherit" });
}

// 1. Sync packages required by the standalone web deployment.
for (const packageName of embeddedPackageNames) {
  const source = path.join(root, "packages", packageName);
  const destination = path.join(webDir, "packages", packageName);
  console.log(`Syncing packages/${packageName} → apps/web/packages/${packageName}...`);
  cpSync(source, destination, { recursive: true });
}

// 2. Regenerate apps/web/package-lock.json in standalone (non-workspace) mode
//    by temporarily hiding the root package.json so npm doesn't treat
//    apps/web as a workspace member.
console.log("Regenerating apps/web/package-lock.json...");
renameSync(rootPkg, rootPkgBak);
try {
  run("npm install --package-lock-only --ignore-scripts", webDir);
} finally {
  renameSync(rootPkgBak, rootPkg);
}

// 3. Deploy
console.log("Deploying...");
run("firebase deploy --only apphosting", webDir);
