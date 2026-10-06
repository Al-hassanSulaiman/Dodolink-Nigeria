const { withInfoPlist, withXcodeProject } = require("expo/config-plugins");
const { addBuildNumberPhase } = require("./iosBuildNumberPhase");

function integerBuildNumber(value) {
  const number = Number(String(value ?? "").replace(/^"(.*)"$/, "$1"));
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function resolveBuildNumber(minimumBuildNumber, ...versions) {
  if (!Number.isSafeInteger(minimumBuildNumber) || minimumBuildNumber < 1) {
    throw new Error("minimumBuildNumber must be a positive integer");
  }
  return String(Math.max(minimumBuildNumber, ...versions.map(integerBuildNumber)));
}

/**
 * Expo Launch can supply a build number below one previously uploaded outside
 * Launch. Enforce the release's minimum in native metadata and at compile time.
 * Raise the minimum when preparing a new release after Apple accepts this one.
 */
function withIosBuildNumberFloor(config, { minimumBuildNumber } = {}) {
  const buildNumber = resolveBuildNumber(minimumBuildNumber, config.ios?.buildNumber);
  config.ios = { ...config.ios, buildNumber };

  config = withInfoPlist(config, (modConfig) => {
    modConfig.modResults.CFBundleVersion = resolveBuildNumber(
      minimumBuildNumber,
      modConfig.ios.buildNumber,
      modConfig.modResults.CFBundleVersion,
    );
    return modConfig;
  });

  return withXcodeProject(config, (modConfig) => {
    const configurations = modConfig.modResults.pbxXCBuildConfigurationSection();
    for (const configuration of Object.values(configurations)) {
      const settings = configuration?.buildSettings;
      if (!settings || !settings.INFOPLIST_FILE) continue;
      settings.CURRENT_PROJECT_VERSION = resolveBuildNumber(
        minimumBuildNumber,
        modConfig.ios.buildNumber,
        settings.CURRENT_PROJECT_VERSION,
      );
    }
    addBuildNumberPhase(modConfig.modResults, minimumBuildNumber);
    return modConfig;
  });
}

module.exports = withIosBuildNumberFloor;
module.exports.resolveBuildNumber = resolveBuildNumber;
