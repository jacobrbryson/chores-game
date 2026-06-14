const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");
const projectNodeModules = path.resolve(projectRoot, "node_modules");
const monorepoNodeModules = path.resolve(monorepoRoot, "node_modules");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];

// Watching the whole monorepo means Metro's file-map crawler also tries to
// watch volatile build output (notably apps/web/.next, which Next.js rewrites
// constantly). On Windows there is no Watchman, so Metro falls back to a Node
// fs.watch crawler that crashes with ENOENT when a directory it enumerated is
// deleted before it can watch it. Exclude build output / nested node_modules
// from the file map so the crawler never touches them. Keep these scoped to
// the apps' own build output — broad patterns like /dist/ would also match
// package internals inside node_modules (e.g. stacktrace-parser/dist) and
// break module resolution.
config.resolver.blockList = new RegExp(
  [
    /.*[\\/]apps[\\/]web[\\/]\.next[\\/].*/,
    /.*[\\/]apps[\\/]web[\\/]\.firebase[\\/].*/,
    /.*[\\/]apps[\\/]mobile[\\/]\.expo[\\/].*/,
    /.*[\\/]apps[\\/]mobile[\\/]web-build[\\/].*/,
  ]
    .map((re) => re.source)
    .join("|")
);
config.resolver.disableHierarchicalLookup = true;
config.resolver.nodeModulesPaths = [projectNodeModules, monorepoNodeModules];
config.resolver.extraNodeModules = {
  // AsyncStorage's web implementation imports idb from its nested dependency tree.
  // With hierarchical lookup disabled in this monorepo, Metro needs an explicit alias.
  idb: path.resolve(monorepoNodeModules, "@react-native-async-storage/async-storage/node_modules/idb"),
  react: path.resolve(projectNodeModules, "react"),
  "react-dom": path.resolve(projectNodeModules, "react-dom"),
};

module.exports = config;
