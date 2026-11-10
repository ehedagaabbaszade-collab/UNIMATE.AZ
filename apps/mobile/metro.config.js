// Metro config for the npm-workspaces monorepo.
// React is pinned to 19.3.0 for this app (the RN 0.88 renderer checks the exact version) while apps/web and
// apps/admin use 19.3.1. Every `react` import, from any package, must therefore resolve to THIS app's copy.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules"), path.resolve(workspaceRoot, "node_modules")];

const reactDir = path.resolve(projectRoot, "node_modules/react");
const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "react" || moduleName.startsWith("react/")) {
    const ctx = { ...context, originModulePath: path.join(projectRoot, "index.js") };
    return (defaultResolve ?? ctx.resolveRequest)(ctx, moduleName, platform);
  }
  return (defaultResolve ?? context.resolveRequest)(context, moduleName, platform);
};
void reactDir;

module.exports = config;
