const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");
const projectNodeModules = path.resolve(projectRoot, "node_modules");
const monorepoNodeModules = path.resolve(monorepoRoot, "node_modules");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
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
