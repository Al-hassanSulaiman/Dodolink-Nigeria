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
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SPM_PATCH = `
# ---- withSpmNilFix: nil-target guard for react-native spm.rb ----
# @clerk/expo registers ClerkKit/ClerkKitUI as SPM dependencies under pod names
# that have no matching Pods project target. spm.rb's apply_on_post_install then
# crashes in TWO places (lines 27 and 33) when project.targets.find returns nil.
#
# Fix: override apply_on_post_install to strip unresolvable pod entries from
# @dependencies_by_pod before the original method runs, so every target lookup
# is guaranteed to find a real object.
#
# IMPORTANT: Use ::SPMManager (top-level constant) — the Podfile DSL evaluates
# inside Pod::Podfile, so a bare 'class SPMManager' would create the wrong class.
class ::SPMManager
  alias_method :apply_on_post_install_without_nil_guard, :apply_on_post_install

  def apply_on_post_install(installer)
    project = installer.pods_project
    @dependencies_by_pod.reject! do |pod_name, _|
      project.targets.none? { |t| t.name == pod_name }
    end
    apply_on_post_install_without_nil_guard(installer)
  end

  private

  # Backport RN's SPM UUID collision fix (facebook/react-native#57576).
  def new_object(project, klass)
    uuid = project.generate_uuid
    uuid = project.generate_uuid while project.objects_by_uuid.key?(uuid)
    object = klass.new(project, uuid)
    object.initialize_defaults
    object
  end

  def add_spm_to_target(project, target, url, requirement, products)
    pkg_class = Xcodeproj::Project::Object::XCRemoteSwiftPackageReference
    ref_class = Xcodeproj::Project::Object::XCSwiftPackageProductDependency
    pkg = project.root_object.package_references.find { |p| p.class == pkg_class && p.repositoryURL == url }
    unless pkg
      pkg = new_object(project, pkg_class)
      pkg.repositoryURL = url
      pkg.requirement = requirement
      project.root_object.package_references << pkg
    end
    products.each do |product_name|
      next if target.package_product_dependencies.any? { |r| r.class == ref_class && r.package == pkg && r.product_name == product_name }
      ref = new_object(project, ref_class)
      ref.package = pkg
      ref.product_name = product_name
      target.package_product_dependencies << ref
    end
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

      content = content.replace(
        /# ---- withSpmNilFix:[\s\S]*?# ---- end withSpmNilFix ----\n?/g,
        ''
      );
      fs.writeFileSync(podfilePath, content + '\n' + SPM_PATCH);

      return modConfig;
    },
  ]);
};
