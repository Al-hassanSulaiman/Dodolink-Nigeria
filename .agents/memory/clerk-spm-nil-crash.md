---
name: Clerk + Expo iOS build failures (spm.rb nil crash, missing ClerkExpo module)
description: "@clerk/expo iOS builds fail unless its config plugin is registered in app.json; nil crash in spm.rb is a symptom, not the root cause"
---

## The Rule
`@clerk/expo` MUST be listed in the `plugins` array of `app.json`. Its config plugin bumps the
iOS deployment target to 17.0 (Clerk's native iOS SDK requires iOS 17). Without it:

1. The `ClerkExpo` pod is never installed into the Pods project (deployment target too low),
2. but Expo autolinking still generates `import ClerkExpo` in ExpoModulesProvider.swift,
3. and react-native's `spm.rb` crashes with `undefined method ... for nil:NilClass` because
   `project.targets.find { |t| t.name == "ClerkExpo" }` returns nil — the target doesn't exist.

## Why
The nil crash in `spm.rb` looked like a react-native bug and was chased through several
symptom patches (nil guards, `reject!` of unresolvable pods). Those made pod install pass but
moved the failure to Swift compile: `no such module 'ClerkExpo'`. The real cause was always
the missing pod, caused by the missing Clerk config plugin. Bumping react-native patch
versions (0.81.5 → 0.81.6) does NOT help.

## How to apply
- Keep `"@clerk/expo"` in `app.json` plugins (near the top).
- `plugins/withSpmNilFix.js` (Podfile monkey-patch that strips SPM entries with no matching
  target) is retained as a harmless safety net — it becomes a no-op once the ClerkExpo target
  exists. If ClerkExpo ever silently disappears from a build again, check deployment target /
  plugin registration first.
- Note: this makes the app require iOS 17+.

## Distinguish a full Pods build-graph failure

If Xcode reports missing module maps for nearly every pod (`Expo`, `EXConstants`,
`ClerkExpo`, and many others) while compiling `ExpoModulesProvider.swift`, do not treat
it as the Clerk-only failure above.

**Why:** Full logs revealed an earlier error: Pods.xcodeproj could not open, with
`XCSwiftPackageProductDependency _setSavedArchiveVersion:`. React Native's SPM
post-install allocator can collide with existing CocoaPods UUIDs and overwrite the
root project object (upstream react-native PR 57576). Module-map errors are secondary.

**How to apply:** Inspect the first Xcode project-loading error, not just EAS's summary.
Retain the upstream collision-safe SPM allocator backport until upgrading to a version
that includes it. Cache/image swaps and explicit-module settings do not repair this.
EAS log objects may be Brotli compressed; Node zlib.brotliDecompressSync decodes them.
