const assert = require("node:assert/strict");
const test = require("node:test");
const withIosBuildNumberFloor = require("./withIosBuildNumberFloor");
const { resolveBuildNumber } = withIosBuildNumberFloor;

test("raises Launch's rejected build 8 above Apple's existing build 17", () => {
  const config = withIosBuildNumberFloor(
    { name: "Dodolink NG", slug: "dodolink-ng", ios: { buildNumber: "8" } },
    { minimumBuildNumber: 19 },
  );
  assert.equal(config.ios.buildNumber, "19");
  assert.equal(resolveBuildNumber(19, "8", "16"), "19");
  assert.ok(config.mods.ios.infoPlist);
  assert.ok(config.mods.ios.xcodeproj);
});

test("preserves newer configured or native build numbers", () => {
  assert.equal(resolveBuildNumber(19, "20", "16"), "20");
  assert.equal(resolveBuildNumber(19, "19", "21"), "21");
});

test("corrects the actual Info.plist mod when Launch supplies a lower version", async () => {
  const config = withIosBuildNumberFloor(
    { name: "Dodolink NG", slug: "dodolink-ng", ios: { buildNumber: "8" } },
    { minimumBuildNumber: 19 },
  );
  const result = await config.mods.ios.infoPlist({
    ...config,
    modResults: { CFBundleVersion: "8", CFBundleIdentifier: "com.dodolink.ng" },
    modRequest: {
      platform: "ios",
      modName: "infoPlist",
      projectRoot: process.cwd(),
      introspect: true,
    },
  });
  assert.equal(result.modResults.CFBundleVersion, "19");
  assert.equal(result.modResults.CFBundleIdentifier, "com.dodolink.ng");
});

test("corrects both native Xcode configurations without lowering newer versions", async () => {
  const config = withIosBuildNumberFloor(
    { name: "Dodolink NG", slug: "dodolink-ng", ios: { buildNumber: "8" } },
    { minimumBuildNumber: 19 },
  );
  const configurations = {
    debug: { buildSettings: { INFOPLIST_FILE: "Info.plist", CURRENT_PROJECT_VERSION: "8" } },
    release: { buildSettings: { INFOPLIST_FILE: "Info.plist", CURRENT_PROJECT_VERSION: "8" } },
    newer: { buildSettings: { INFOPLIST_FILE: "Info.plist", CURRENT_PROJECT_VERSION: "20" } },
    comment: "Release",
    project: { buildSettings: { OTHER_SETTING: "unchanged" } },
  };
  await config.mods.ios.xcodeproj({
    ...config,
    modResults: { pbxXCBuildConfigurationSection: () => configurations },
    modRequest: {
      platform: "ios",
      modName: "xcodeproj",
      projectRoot: process.cwd(),
      introspect: false,
    },
  });
  assert.equal(configurations.debug.buildSettings.CURRENT_PROJECT_VERSION, "19");
  assert.equal(configurations.release.buildSettings.CURRENT_PROJECT_VERSION, "19");
  assert.equal(configurations.newer.buildSettings.CURRENT_PROJECT_VERSION, "20");
  assert.equal(configurations.project.buildSettings.OTHER_SETTING, "unchanged");
});

test("handles missing metadata and Xcode build-setting references", () => {
  assert.equal(resolveBuildNumber(19, undefined, "$(CURRENT_PROJECT_VERSION)"), "19");
  assert.equal(resolveBuildNumber(19, '"22"'), "22");
});

test("rejects an invalid minimum instead of generating an invalid Apple version", () => {
  for (const minimum of [undefined, 0, -1, 19.5, "19"]) {
    assert.throws(() => resolveBuildNumber(minimum, "8"), /positive integer/);
  }
});
