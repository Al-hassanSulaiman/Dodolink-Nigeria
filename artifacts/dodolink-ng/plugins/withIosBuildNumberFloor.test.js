const assert = require("node:assert/strict");
const test = require("node:test");
const withIosBuildNumberFloor = require("./withIosBuildNumberFloor");
const { resolveBuildNumber } = withIosBuildNumberFloor;
const { PHASE_NAME, buildNumberScript, addBuildNumberPhase } = require("./iosBuildNumberPhase");

function mockProject(configurations = {}) {
  const target = { uuid: "APP", firstTarget: { buildPhases: [{ value: "SOURCES", comment: "Sources" }] } };
  return {
    hash: { project: { objects: { PBXShellScriptBuildPhase: {} } } },
    pbxXCBuildConfigurationSection: () => configurations,
    getFirstTarget: () => target,
    addBuildPhase(files, type, comment, uuid, options) {
      assert.equal(uuid, "APP");
      const phase = { ...options };
      this.hash.project.objects[type].FLOOR = phase;
      target.firstTarget.buildPhases.push({ value: "FLOOR", comment });
      return { uuid: "FLOOR", buildPhase: phase };
    },
  };
}

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
    modResults: mockProject(configurations),
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

test("compile-time guard runs first, declares its plist output and is idempotent", () => {
  const project = mockProject();
  addBuildNumberPhase(project, 19);
  addBuildNumberPhase(project, 20);
  const phases = project.getFirstTarget().firstTarget.buildPhases;
  assert.deepEqual(phases.map((phase) => phase.comment), [PHASE_NAME, "Sources"]);
  const phase = project.hash.project.objects.PBXShellScriptBuildPhase.FLOOR;
  assert.equal(phase.alwaysOutOfDate, 1);
  assert.deepEqual(phase.outputPaths, ['"$(PROJECT_DIR)/$(INFOPLIST_FILE)"']);
  assert.match(phase.shellScript, /Set :CFBundleVersion 20/);
});

test("compile-time script repairs a cloud rewrite to 9 and preserves a newer version", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { spawnSync } = require("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ios-build-floor-"));
  try {
    const plist = path.join(dir, "Info.plist");
    const buddy = path.join(dir, "plist-buddy");
    fs.writeFileSync(buddy, `#!${process.execPath}
const fs = require("node:fs");
const [flag, command, file] = process.argv.slice(2);
if (flag !== "-c") process.exit(1);
const plist = JSON.parse(fs.readFileSync(file, "utf8"));
if (command === "Print :CFBundleVersion") console.log(plist.CFBundleVersion);
else if (command.startsWith("Set :CFBundleVersion ")) {
  plist.CFBundleVersion = command.split(" ").pop();
  fs.writeFileSync(file, JSON.stringify(plist));
} else process.exit(1);
`);
    fs.chmodSync(buddy, 0o755);
    const script = buildNumberScript(19).replaceAll("/usr/libexec/PlistBuddy", `"${buddy}"`);
    for (const [before, after] of [["9", "19"], ["20", "20"], ["$(CURRENT_PROJECT_VERSION)", "19"]]) {
      fs.writeFileSync(plist, JSON.stringify({ CFBundleVersion: before }));
      const result = spawnSync("/bin/sh", ["-c", script], {
        env: { ...process.env, PROJECT_DIR: dir, INFOPLIST_FILE: "Info.plist", CURRENT_PROJECT_VERSION: "9" },
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(fs.readFileSync(plist, "utf8")).CFBundleVersion, after);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
