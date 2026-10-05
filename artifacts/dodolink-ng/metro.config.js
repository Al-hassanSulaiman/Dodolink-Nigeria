const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

const CLERK_NATIVE_SHIM = path.resolve(
  __dirname,
  "patches/NativeClerkModule.android.js"
);

const originalResolveRequest = config.resolver?.resolveRequest;

config.resolver = {
  ...config.resolver,
  resolveRequest(context, moduleName, platform) {
    // Shared libraries and hoisted packages must use the app's React instance.
    if (moduleName === "react" || moduleName.startsWith("react/")) {
      return {
        filePath: require.resolve(moduleName, { paths: [__dirname] }),
        type: "sourceFile",
      };
    }
    if (
      platform === "android" &&
      context.originModulePath?.includes("@clerk/expo") &&
      /NativeClerkModule$/.test(moduleName)
    ) {
      return { filePath: CLERK_NATIVE_SHIM, type: "sourceFile" };
    }
    if (originalResolveRequest) {
      return originalResolveRequest(context, moduleName, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
  },
};

module.exports = config;
