import { register } from "node:module";

// Loaded with `node --import ./scripts/lib/ts-alias-register.mjs` so the resolve
// hook is installed before the entry module is evaluated.
register("./ts-alias-hooks.mjs", import.meta.url);
