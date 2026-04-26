import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const workspaceCandidate = path.resolve(projectRoot, "../..");
const appFromWorkspaceCandidate = path.join(projectRoot, "apps", "web");
const candidateRoots = Array.from(
  new Set(
    [projectRoot, workspaceCandidate, appFromWorkspaceCandidate]
      .map((value) => path.resolve(value))
      .filter((value) => value !== path.parse(value).root)
      .filter((value) => existsSync(path.join(value, "package.json"))),
  ),
);

function findFirstExisting(paths) {
  for (const candidate of paths) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return "";
}

function findNestedStandaloneServer(standaloneRootDir) {
  const directCandidates = [
    path.join(standaloneRootDir, "apps", "web", "server.js"),
    path.join(standaloneRootDir, "apps", "web", "apps", "web", "server.js"),
    path.join(standaloneRootDir, "server.js"),
  ];
  const direct = findFirstExisting(directCandidates.filter((entry) => !entry.endsWith(`${path.sep}standalone${path.sep}server.js`)));
  if (direct) {
    return direct;
  }

  const stack = [standaloneRootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") {
          continue;
        }
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name === "server.js") {
        return fullPath;
      }
    }
  }

  return "";
}

function ensureFile(sourcePath, destinationPath, label) {
  if (!existsSync(sourcePath)) {
    console.warn(`[ensure-standalone-routes-manifest] Skipped ${label}: source not found.`);
    return;
  }
  if (existsSync(destinationPath)) {
    return;
  }
  mkdirSync(path.dirname(destinationPath), { recursive: true });
  copyFileSync(sourcePath, destinationPath);
  console.log(`[ensure-standalone-routes-manifest] Copied ${label}.`);
}

function ensureStandaloneArtifacts(targetRoot) {
  const standaloneDir = path.join(targetRoot, ".next", "standalone");
  const standaloneRoot = path.join(standaloneDir, ".next");
  console.log(`[ensure-standalone-routes-manifest] target=${targetRoot}`);

  const targetNestedServer = path.join(standaloneDir, "apps", "web", "server.js");
  if (!existsSync(targetNestedServer)) {
    const standaloneSourceDir = findFirstExisting(
      candidateRoots.map((root) => {
        const nestedServer = path.join(root, ".next", "standalone", "apps", "web", "server.js");
        return existsSync(nestedServer) ? path.join(root, ".next", "standalone") : "";
      }).filter(Boolean),
    );
    if (standaloneSourceDir && standaloneSourceDir !== standaloneDir) {
      mkdirSync(path.dirname(standaloneDir), { recursive: true });
      cpSync(standaloneSourceDir, standaloneDir, { recursive: true });
      console.log(
        `[ensure-standalone-routes-manifest] Mirrored standalone tree ${standaloneSourceDir} -> ${standaloneDir}.`,
      );
    }
  }

  const routesSourceCandidates = candidateRoots.map((root) =>
    path.join(root, ".next", "routes-manifest.json"),
  );
  const routesSource = findFirstExisting([
    path.join(targetRoot, ".next", "routes-manifest.json"),
    ...routesSourceCandidates,
  ]);
  if (routesSource) {
    ensureFile(
      routesSource,
      path.join(standaloneRoot, "routes-manifest.json"),
      `routes-manifest.json -> ${targetRoot}`,
    );
  } else {
    console.warn("[ensure-standalone-routes-manifest] Skipped routes-manifest.json: source not found.");
  }

  const middlewareSourceCandidates = candidateRoots.map((root) =>
    path.join(root, ".next", "server", "middleware-manifest.json"),
  );
  const middlewareSource = findFirstExisting([
    path.join(targetRoot, ".next", "server", "middleware-manifest.json"),
    ...middlewareSourceCandidates,
  ]);
  if (middlewareSource) {
    ensureFile(
      middlewareSource,
      path.join(standaloneRoot, "server", "middleware-manifest.json"),
      `server/middleware-manifest.json -> ${targetRoot}`,
    );
  } else {
    console.warn(
      "[ensure-standalone-routes-manifest] Skipped server/middleware-manifest.json: source not found.",
    );
  }

  const rootStandaloneServer = path.join(targetRoot, ".next", "standalone", "server.js");
  const nestedStandaloneServer = findNestedStandaloneServer(standaloneDir);
  if (!existsSync(rootStandaloneServer) && nestedStandaloneServer) {
    mkdirSync(path.dirname(rootStandaloneServer), { recursive: true });
    const relativeTarget = path
      .relative(path.dirname(rootStandaloneServer), nestedStandaloneServer)
      .replace(/\\/g, "/");
    writeFileSync(rootStandaloneServer, `require('./${relativeTarget}');\n`, "utf8");
    console.log(
      `[ensure-standalone-routes-manifest] Created standalone/server.js wrapper at ${targetRoot} -> ${relativeTarget}.`,
    );
  } else if (existsSync(rootStandaloneServer)) {
    console.log(
      `[ensure-standalone-routes-manifest] standalone/server.js already present at ${targetRoot}.`,
    );
  } else {
    console.warn(
      `[ensure-standalone-routes-manifest] Could not create standalone/server.js at ${targetRoot}: nested source missing.`,
    );
  }
}

console.log(`[ensure-standalone-routes-manifest] cwd=${projectRoot}`);
console.log(
  `[ensure-standalone-routes-manifest] roots=${candidateRoots.join(" | ")}`,
);
ensureStandaloneArtifacts(projectRoot);
for (const root of candidateRoots) {
  if (root === projectRoot) {
    continue;
  }
  ensureStandaloneArtifacts(root);
}
