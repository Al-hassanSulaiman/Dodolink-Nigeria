/**
 * Expo config plugin: withSpmNilFix
 *
 * Monkey-patches react-native's SPMManager#add_spm_to_target (spm.rb) to add a
 * nil-target guard. Without this, @clerk/expo registers ClerkKit/ClerkKitUI as SPM
 * dependencies under a pod name that has no matching Pods project target, causing
 * `project.targets.find { |t| t.name == pod_name }` to return nil. The unpatched
 * code then calls `nil.package_product_dependencies` and crashes during pod install.
 *
 * Fix: reopen SPMManager after it is loaded and redefine add_spm_to_target to
 * return early when target is nil.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SPM_PATCH = `
# ---- withSpmNilFix: nil-target guard for react-native spm.rb ----
# Triggered when @clerk/expo registers ClerkKit/ClerkKitUI as SPM dependencies
# but no matching Pods project target exists for those pod names.
class SPMManager
  private

  alias_method :add_spm_to_target_without_nil_guard, :add_spm_to_target

  def add_spm_to_target(project, target, url, requirement, products)
    return if target.nil?
    add_spm_to_target_without_nil_guard(project, target, url, requirement, products)
  end
end
# ---- end withSpmNilFix ----
`;

module.exports = function withSpmNilFix(config) {
  return withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      const podfilePath = path.join(
        modConfig.modRequest.platformProjectRoot,
        'Podfile'
      );

      if (!fs.existsSync(podfilePath)) {
        return modConfig;
      }

      let content = fs.readFileSync(podfilePath, 'utf-8');

      // Only patch once
      if (!content.includes('withSpmNilFix')) {
        content = content + '\n' + SPM_PATCH;
        fs.writeFileSync(podfilePath, content);
      }

      return modConfig;
    },
  ]);
};
