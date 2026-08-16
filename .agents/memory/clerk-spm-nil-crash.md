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
