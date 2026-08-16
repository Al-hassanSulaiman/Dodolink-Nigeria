---
name: Clerk + React Native spm.rb nil crash
description: @clerk/expo causes "undefined method 'package_product_dependencies' for nil:NilClass" during pod install on Expo SDK 54 iOS builds
---

## The Rule
When `@clerk/expo` is installed, Expo iOS builds crash in `pod install` with:
`undefined method 'package_product_dependencies' for nil:NilClass`
in `react-native/scripts/cocoapods/spm.rb:80`

This affects react-native 0.81.5 AND 0.81.6 — it is NOT a react-native version issue.

## Why
`@clerk/expo` registers `ClerkKit` and `ClerkKitUI` as SPM dependencies on its pod.
In `spm.rb#apply_on_post_install`, RN calls:
`project.targets.find { |t| t.name == pod_name }`
When `pod_name` is the Clerk pod name and no matching Pods project target exists,
`find` returns nil. `add_spm_to_target` is then called with nil target and crashes
at `target.package_product_dependencies`.

## Fix
A config plugin (`plugins/withSpmNilFix.js`) monkey-patches `SPMManager#add_spm_to_target`
in the generated Podfile to add `return if target.nil?` before the crash site.
Register it as the FIRST plugin in `app.json` so it runs during Expo prebuild on EAS.

The plugin uses `withDangerousMod` for iOS to append the Ruby patch to the Podfile.
The patch reopens `SPMManager`, aliases the original private method, and redefines it
with a nil guard.

**Why:** Bumping react-native patch versions does NOT fix this — the bug exists in both
0.81.5 and 0.81.6. The only viable fix without editing node_modules is a config plugin
that patches the generated Podfile.

## How to apply
Ensure `artifacts/dodolink-ng/plugins/withSpmNilFix.js` exists and is registered as
the first entry in the `plugins` array in `app.json`.
