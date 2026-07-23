import { useSignUp, useAuth, useOAuth } from "@clerk/expo";
import { type Href, Link, useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { showAlert } from "@/utils/alerts";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { FontAwesome5 } from "@expo/vector-icons";

export default function SignUpPage() {
  const { signUp, errors, fetchStatus } = useSignUp();
  const { isSignedIn } = useAuth();
  const router = useRouter();

  const [emailAddress, setEmailAddress] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [appleLoading, setAppleLoading] = React.useState(false);

  const { startOAuthFlow: startAppleOAuth } = useOAuth({ strategy: "oauth_apple" });

  const handleAppleSignIn = async () => {
    setAppleLoading(true);
    try {
      const { createdSessionId, setActive } = await startAppleOAuth();
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
        router.replace("/(tabs)" as Href);
      }
    } catch (err: any) {
      const msg = err?.errors?.[0]?.longMessage ?? err?.message ?? "Apple sign in failed. Please try again.";
      showAlert("Apple Sign In", msg);
    } finally {
      setAppleLoading(false);
    }
  };

  const handleSubmit = async () => {
    const { error } = await signUp.password({ emailAddress, password });
    if (error) {
      // Already signed in? Just go straight into the app.
      const errCode = (error as any)?.errors?.[0]?.code ?? (error as any)?.code;
      if (errCode === "session_exists" || isSignedIn) {
        router.replace("/(tabs)" as Href);
      }
      return;
    }
    await signUp.verifications.sendEmailCode();
  };

  const handleVerify = async () => {
    try {
      await signUp.verifications.verifyEmailCode({ code });
      const result = signUp;

      if (result.status === "complete") {
        // finalize() converts the completed sign-up into the active session.
        const { error: finalizeError } = await result.finalize();
        if (finalizeError) {
          const errCode = (finalizeError as any)?.errors?.[0]?.code ?? (finalizeError as any)?.code;
          if (errCode !== "session_exists") {
            const msg =
              (finalizeError as any)?.errors?.[0]?.longMessage ??
              (finalizeError as any)?.longMessage ??
              (finalizeError as any)?.message ??
              "Could not complete sign up. Please try again.";
            showAlert("Sign up error", msg);
            return;
          }
        }
        router.replace("/(tabs)" as Href);
      } else if ((result.status as string) === "needs_client_trust") {
        await result.finalize({
          navigate: ({ decorateUrl }: { decorateUrl: (url: string) => string }) => {
            (globalThis as any).location.href = decorateUrl("/");
          },
        });
      } else {
        showAlert("Verification incomplete", `Status: ${result.status ?? "unknown"}`);
      }
    } catch (err: any) {
      const msg = err?.errors?.[0]?.longMessage ?? err?.message ?? String(err);
      showAlert("Verification error", msg);
    }
  };

  const isLoading = fetchStatus === "fetching";
  const showVerification =
    signUp.status === "missing_requirements" &&
    signUp.unverifiedFields.includes("email_address") &&
    signUp.missingFields.length === 0;

  if (signUp.status === "complete") return null;

  if (showVerification) {
    return (
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <ScrollView
            contentContainerStyle={styles.container}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.header}>
              <View style={styles.logoMark}>
                <Text style={styles.logoText}>D</Text>
              </View>
              <Text style={styles.title}>Check your email</Text>
              <Text style={styles.subtitle}>
                We sent a verification code to{"\n"}
                <Text style={styles.emailHighlight}>{emailAddress}</Text>
              </Text>
            </View>

            <View style={styles.form}>
              <View style={styles.field}>
                <Text style={styles.label}>Verification code</Text>
                <TextInput
                  style={[styles.input, !!errors.fields.code && styles.inputError]}
                  keyboardType="number-pad"
                  placeholder="Enter 6-digit code"
                  placeholderTextColor="#9CA3AF"
                  value={code}
                  onChangeText={setCode}
                  maxLength={6}
                />
                {!!errors.fields.code && (
                  <Text style={styles.fieldError}>{errors.fields.code.message}</Text>
                )}
              </View>

              {!!errors.global?.length && (
                <View style={styles.globalError}>
                  <Text style={styles.globalErrorText}>{(errors.global?.[0] as any)?.longMessage ?? errors.global?.[0]?.message}</Text>
                </View>
              )}

              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  (!code || isLoading) && styles.buttonDisabled,
                  pressed && code && !isLoading && styles.buttonPressed,
                ]}
                onPress={handleVerify}
                disabled={!code || isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.buttonText}>Verify email</Text>
                )}
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
                onPress={() => signUp.verifications.sendEmailCode()}
              >
                <Text style={styles.secondaryButtonText}>Resend code</Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  const canSubmit = emailAddress.length > 0 && password.length >= 8 && !isLoading;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <View style={styles.logoMark}>
              <Text style={styles.logoText}>D</Text>
            </View>
            <Text style={styles.title}>Create account</Text>
            <Text style={styles.subtitle}>Join Dodolink — Nigeria's marketplace</Text>
          </View>

          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={styles.label}>Email address</Text>
              <TextInput
                style={[styles.input, !!errors.fields.emailAddress && styles.inputError]}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                placeholder="you@example.com"
                placeholderTextColor="#9CA3AF"
                value={emailAddress}
                onChangeText={setEmailAddress}
              />
              {!!errors.fields.emailAddress && (
                <Text style={styles.fieldError}>{errors.fields.emailAddress.message}</Text>
              )}
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.passwordContainer}>
                <TextInput
                  style={[
                    styles.input,
                    styles.passwordInput,
                    !!errors.fields.password && styles.inputError,
                  ]}
                  secureTextEntry={!showPassword}
                  textContentType="newPassword"
                  placeholder="At least 8 characters"
                  placeholderTextColor="#9CA3AF"
                  value={password}
                  onChangeText={setPassword}
                />
                <Pressable
                  style={styles.eyeBtn}
                  onPress={() => setShowPassword(v => !v)}
                  hitSlop={8}
                >
                  <Feather
                    name={showPassword ? "eye-off" : "eye"}
                    size={18}
                    color="#9CA3AF"
                  />
                </Pressable>
              </View>
              {!!errors.fields.password && (
                <Text style={styles.fieldError}>{errors.fields.password.message}</Text>
              )}
            </View>

            {!!errors.global?.length && (
              <View style={styles.globalError}>
                <Text style={styles.globalErrorText}>{(errors.global?.[0] as any)?.longMessage ?? errors.global?.[0]?.message}</Text>
              </View>
            )}

            <Pressable
              style={({ pressed }) => [
                styles.button,
                !canSubmit && styles.buttonDisabled,
                pressed && canSubmit && styles.buttonPressed,
              ]}
              onPress={handleSubmit}
              disabled={!canSubmit}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.buttonText}>Create account</Text>
              )}
            </Pressable>
          </View>

          <View nativeID="clerk-captcha" />

          {Platform.OS === "ios" && (
            <>
              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.dividerLine} />
              </View>
              <Pressable
                style={({ pressed }) => [
                  styles.appleButton,
                  pressed && styles.buttonPressed,
                  appleLoading && styles.buttonDisabled,
                ]}
                onPress={handleAppleSignIn}
                disabled={appleLoading}
              >
                {appleLoading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <FontAwesome5 name="apple" size={18} color="#fff" />
                    <Text style={styles.appleButtonText}>Continue with Apple</Text>
                  </>
                )}
              </Pressable>
            </>
          )}

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <Link href="/(auth)/sign-in" asChild>
              <Pressable>
                <Text style={styles.footerLink}>Sign in</Text>
              </Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F9FAFB" },
  flex: { flex: 1 },
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 32,
    justifyContent: "center",
  },
  header: { alignItems: "center", marginBottom: 40 },
  logoMark: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: "#1B5E20",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  logoText: {
    fontSize: 32,
    fontWeight: "700",
    color: "#fff",
    fontFamily: "Inter_700Bold",
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#111827",
    fontFamily: "Inter_700Bold",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: "#6B7280",
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  emailHighlight: {
    color: "#1B5E20",
    fontFamily: "Inter_600SemiBold",
  },
  form: { gap: 16 },
  field: { gap: 6 },
  label: {
    fontSize: 14,
    fontWeight: "500",
    color: "#374151",
    fontFamily: "Inter_500Medium",
  },
  input: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: "#111827",
    backgroundColor: "#fff",
    fontFamily: "Inter_400Regular",
  },
  passwordContainer: {
    position: "relative",
  },
  passwordInput: {
    paddingRight: 48,
  },
  eyeBtn: {
    position: "absolute",
    right: 14,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  inputError: { borderColor: "#EF4444" },
  fieldError: {
    fontSize: 13,
    color: "#EF4444",
    fontFamily: "Inter_400Regular",
  },
  globalError: {
    backgroundColor: "#FEF2F2",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  globalErrorText: {
    color: "#DC2626",
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  button: {
    backgroundColor: "#1B5E20",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  buttonDisabled: { backgroundColor: "#9CA3AF" },
  buttonPressed: { opacity: 0.85 },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  secondaryButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#D1D5DB",
    backgroundColor: "#fff",
  },
  secondaryButtonText: {
    color: "#374151",
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 32,
  },
  footerText: {
    fontSize: 14,
    color: "#6B7280",
    fontFamily: "Inter_400Regular",
  },
  footerLink: {
    fontSize: 14,
    color: "#1B5E20",
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 16,
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#E5E7EB",
  },
  dividerText: {
    fontSize: 13,
    color: "#9CA3AF",
    fontFamily: "Inter_400Regular",
  },
  appleButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000",
    borderRadius: 12,
    paddingVertical: 16,
    gap: 10,
    marginBottom: 8,
  },
  appleButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
});
