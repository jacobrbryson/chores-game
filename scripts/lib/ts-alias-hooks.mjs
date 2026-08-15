import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Node ESM resolve hook that teaches `node --experimental-strip-types` the two
 * things this repo's TypeScript relies on and Node does not implement:
 *
 *  1. The `@/*` path alias from `apps/web/tsconfig.json` -> `apps/web/src/*`.
 *  2. Extensionless imports (`./foo` -> `./foo.ts`, `./foo/index.ts`).
 *
 * This exists so `scripts/*.ts` can import the real `lib/firestore/admin.ts`
 * admin helpers instead of re-implementing service-account auth and pagination
 * in a standalone `.mjs` file. Type stripping does the rest — nothing is
 * compiled or emitted, and no build step is introduced.
 */

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
const WEB_SRC = path.join(REPO_ROOT, "apps", "web", "src");

const EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".mjs"];

function resolveFile(target) {
  if (existsSync(target) && statSync(target).isFile()) {
    return target;
  }
  for (const extension of EXTENSIONS) {
    const candidate = `${target}${extension}`;
    if (existsSync(candidate)) return candidate;
  }
  for (const extension of EXTENSIONS) {
    const candidate = path.join(target, `index${extension}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const resolved = resolveFile(path.join(WEB_SRC, specifier.slice(2)));
    if (resolved) {
      return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }
  }

  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    if (!path.extname(specifier) && context.parentURL?.startsWith("file:")) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL));
      const resolved = resolveFile(path.resolve(parentDir, specifier));
      if (resolved) {
        return { url: pathToFileURL(resolved).href, shortCircuit: true };
      }
    }
  }

  return nextResolve(specifier, context);
}
