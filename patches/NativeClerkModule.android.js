let expo = require("expo");

// Expo Go compatible shim: uses optional loading so the app doesn't crash
// when the ClerkExpo native module isn't present (e.g. in Expo Go).
// A real dev build will include the ClerkExpo native module and this
// will resolve to the actual module instead of null.
var NativeClerkModule_android_default =
  expo.requireOptionalNativeModule
    ? expo.requireOptionalNativeModule("ClerkExpo")
    : null;

module.exports = NativeClerkModule_android_default;
