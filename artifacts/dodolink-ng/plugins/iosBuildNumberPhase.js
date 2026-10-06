const PHASE_NAME = "Enforce iOS release build number";

function buildNumberScript(minimumBuildNumber) {
  if (!Number.isSafeInteger(minimumBuildNumber) || minimumBuildNumber < 1) {
    throw new Error("minimumBuildNumber must be a positive integer");
  }
  return `set -eu
plist="$INFOPLIST_FILE"
case "$plist" in
  /*) ;;
  *) plist="$PROJECT_DIR/$plist" ;;
esac
current=$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$plist")
case "$current" in
  ""|*[!0-9]*) current="\${CURRENT_PROJECT_VERSION:-0}" ;;
esac
case "$current" in
  ""|*[!0-9]*) echo "Invalid iOS build number: $current" >&2; exit 1 ;;
esac
if [ "$current" -lt "${minimumBuildNumber}" ]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${minimumBuildNumber}" "$plist"
  current="${minimumBuildNumber}"
fi
echo "iOS native build-number floor verified: $current"
`;
}

function addBuildNumberPhase(project, minimumBuildNumber) {
  const target = project.getFirstTarget();
  if (!target?.firstTarget?.buildPhases) {
    throw new Error("Cannot enforce the iOS build number: app target is missing");
  }
  const phases = project.hash.project.objects.PBXShellScriptBuildPhase || {};
  let phaseId = target.firstTarget.buildPhases.find(
    (phase) => phase.comment === PHASE_NAME,
  )?.value;
  const script = buildNumberScript(minimumBuildNumber).replace(/\n/g, "\\n");
  // Producing the source plist makes ProcessInfoPlistFile depend on this phase.
  // Run before compilation/signing, after any cloud pre-build version rewrite.
  const options = {
    shellPath: "/bin/sh",
    shellScript: script,
    inputPaths: [],
    outputPaths: ['"$(PROJECT_DIR)/$(INFOPLIST_FILE)"'],
  };
  if (phaseId && phases[phaseId]) {
    phases[phaseId].shellScript = `"${script.replace(/"/g, '\\"')}"`;
    phases[phaseId].outputPaths = options.outputPaths;
  } else {
    phaseId = project.addBuildPhase(
      [],
      "PBXShellScriptBuildPhase",
      PHASE_NAME,
      target.uuid,
      options,
    ).uuid;
  }
  project.hash.project.objects.PBXShellScriptBuildPhase[phaseId].alwaysOutOfDate = 1;
  target.firstTarget.buildPhases = [
    { value: phaseId, comment: PHASE_NAME },
    ...target.firstTarget.buildPhases.filter((phase) => phase.value !== phaseId),
  ];
}

module.exports = { PHASE_NAME, buildNumberScript, addBuildNumberPhase };
