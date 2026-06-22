---
name: Link asChild array-style crash (React 19 + expo-router 6 web)
description: expo-router 6's Link asChild on web makes the child (e.g. Pressable) render as a real DOM <a> element; React 19 throws TypeError on array style props passed to real DOM elements
---

## The rule
When using `<Link asChild>` in expo-router 6 on web, the direct child component is rendered as a real DOM `<a>` element. React 19's strict CSS handling throws `TypeError: Failed to set an indexed property [0] on 'CSSStyleDeclaration'` when an array (`[styles.foo, { color: ... }]`) is passed as the `style` prop to that child.

**Fix:** Wrap every array style on a direct child of `Link asChild` with `StyleSheet.flatten(...)`:
```tsx
// WRONG — crashes on web with React 19
<Link href="/foo" asChild>
  <Pressable style={[styles.card, { backgroundColor: colors.card }]}>

// CORRECT
<Link href="/foo" asChild>
  <Pressable style={StyleSheet.flatten([styles.card, { backgroundColor: colors.card }])}>
```

Also applies to bare `<Link style={[...]}> ` (without asChild) — use `StyleSheet.flatten` there too.

**Why:** React 19 enforces that `CSSStyleDeclaration` indexed properties (numeric keys like `[0]`) cannot be set. JavaScript arrays have numeric string keys, so iterating over an array-style object with `for...in` produces key `"0"`, causing the throw. React Native Web components (View, Text, Pressable) handle array styles internally — the crash only occurs when the style array reaches a real DOM element.

**How to apply:** Whenever you write `<Link ... asChild>` in this codebase, check that the direct child's `style` prop is either a single style object (not an array) or wrapped in `StyleSheet.flatten`. Same for bare `<Link style={...}>` on web.
