import { useSignIn, useAuth } from "@clerk/expo";
import { useSignInWithApple } from "@clerk/expo/apple";
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
import * as WebBrowser from "expo-web-browser";

const PRIVACY_URL = "https://dodolink.com.ng/admin/privacy";
const TERMS_URL = "https://dodolink.com.ng/admin/terms";
const APPLE_SIGN_IN_ENABLED = false;

type VerificationMode = "client_trust" | "second_factor";
type SecondFactorStrategy =
  | "email_code"
  | "phone_code"
  | "totp"
  | "backup_code";

const SECOND_FACTOR_PRIORITY: SecondFactorStrategy[] = [
  "email_code",
  "phone_code",
  "totp",
  "backup_code",
];

function getErrorMessage(error: any, fallback: string): string {
  return (
    error?.errors?.[0]?.longMessage ??
    error?.errors?.[0]?.message ??
    error?.longMessage ??
    error?.message ??
    fallback
  );
}

function factorLabel(strategy: string): string {
  switch (strategy) {
    case "email_code":
      return "Email code";
    case "phone_code":
      return "SMS code";
    case "totp":
      return "Authenticator app";
    case "backup_code":
      return "Backup code";
    case "email_link":
      return "Email link";
    default:
      return strategy.replace(/_/g, " ");
  }
}

export default function SignInPage() {
  const { signIn, errors, fetchStatus } = useSignIn();
  const { isSignedIn } = useAuth();
  const router = useRouter();

  const [emailAddress, setEmailAddress] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [verificationMode, setVerificationMode] =
    React.useState<VerificationMode | null>(null);
  const [secondFactorStrategy, setSecondFactorStrategy] =
    React.useState<SecondFactorStrategy | null>(null);
  const [code, setCode] = React.useState("");
  const [actionLoading, setActionLoading] = React.useState(false);
  const [finalizeFailed, setFinalizeFailed] = React.useState(false);
  const [appleLoading, setAppleLoading] = React.useState(false);

  const { startAppleAuthenticationFlow } = useSignInWithApple();

  const handleAppleSignIn = async () => {
    setAppleLoading(true);
    try {
      const { createdSessionId, setActive } =
        await startAppleAuthenticationFlow();
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
        router.replace("/(tabs)" as Href);
        return;
      }

      showAlert(
        "Apple Sign In",
        "Apple sign in could not create a session. Please try again.",
      );
    } catch (err: any) {
      if (err?.code === "ERR_REQUEST_CANCELED") return;

      const msg =
        err?.errors?.[0]?.longMessage ??
        err?.message ??
        "Apple sign in failed. Please try again.";
      showAlert("Apple Sign In", msg);
    } finally {
      setAppleLoading(false);
    }
  };

  const isAlreadySignedInError = (err: any): boolean => {
    const code = err?.errors?.[0]?.code ?? err?.code;
    return code === "session_exists";
  };

  const goToApp = () => {
    router.replace("/(tabs)" as Href);
  };

  const finalizeSession = async () => {
    setFinalizeFailed(false);
    setActionLoading(true);

    let lastError: any = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const { error } = await signIn.finalize();
        if (!error || isAlreadySignedInError(error)) {
          goToApp();
          return true;
        }
        lastError = error;
      } catch (err) {
        lastError = err;
      }

      // A native token cache can finish updating just after the first
      // finalize request. Retry once before asking the user to try again.
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    setFinalizeFailed(true);
    setActionLoading(false);
    showAlert(
      "Sign in error",
      getErrorMessage(
        lastError,
        "Could not finish signing you in. Check your connection and try again.",
      ),
    );
    return false;
  };

  const startSecondFactor = async (
    mode: VerificationMode,
    preferredStrategy?: string,
  ) => {
    const supported = (signIn.supportedSecondFactors ?? [])
      .map((factor: { strategy: string }) => factor.strategy)
      .filter((strategy: string): strategy is SecondFactorStrategy =>
        SECOND_FACTOR_PRIORITY.includes(strategy as SecondFactorStrategy),
      );
    const strategy =
      (preferredStrategy &&
        supported.includes(preferredStrategy as SecondFactorStrategy) &&
        (preferredStrategy as SecondFactorStrategy)) ||
      (SECOND_FACTOR_PRIORITY.find((candidate) => supported.includes(candidate)) ??
        null);

    setVerificationMode(mode);
    setSecondFactorStrategy(strategy);
    setCode("");

    if (!strategy) {
      const hasEmailLink = (signIn.supportedSecondFactors ?? []).some(
        (factor: { strategy: string }) => factor.strategy === "email_link",
      );
      showAlert(
        "Verification unavailable",
        hasEmailLink
          ? "This account requires an email link for verification. Open the sign-in link on this device, then try again."
          : "No supported verification method was provided by Clerk. Please try again.",
      );
      return false;
    }

    if (strategy !== "email_code" && strategy !== "phone_code") return true;

    setActionLoading(true);
    try {
      const result =
        strategy === "email_code"
          ? await signIn.mfa.sendEmailCode()
          : await signIn.mfa.sendPhoneCode();
      if (result?.error) {
        showAlert(
          "Could not send code",
          getErrorMessage(result.error, "Please try again."),
        );
        return false;
      }
      return true;
    } catch (err: any) {
      showAlert(
        "Could not send code",
        getErrorMessage(err, "Please try again."),
      );
      return false;
    } finally {
      setActionLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (actionLoading || isLoading) return;
    setFinalizeFailed(false);
    try {
      const { error } = await signIn.password({ emailAddress, password });
      if (error) {
        // Already signed in? Just go straight into the app.
        if (isAlreadySignedInError(error) || isSignedIn) {
          goToApp();
          return;
        }
        showAlert(
          "Sign in failed",
          getErrorMessage(
            error,
            "Please check your email and password and try again.",
          ),
        );
        return;
      }

      if (signIn.status === "complete") {
        await finalizeSession();
      } else if (signIn.status === "needs_client_trust") {
        await startSecondFactor("client_trust");
      } else if (signIn.status === "needs_second_factor") {
        await startSecondFactor("second_factor");
      } else {
        showAlert(
          "Sign in incomplete",
          `Status: ${signIn.status ?? "unknown"}`,
        );
      }
    } catch (err: any) {
      // If the session was actually created despite the error, enter the app.
      if (isAlreadySignedInError(err) || isSignedIn) {
        goToApp();
        return;
      }
      showAlert(
        "Sign in error",
        getErrorMessage(err, "Please try again."),
      );
    }
  };

  const handleVerify = async () => {
    if (!secondFactorStrategy || !code.trim() || actionLoading) return;
    setActionLoading(true);
    try {
      const result =
        secondFactorStrategy === "email_code"
          ? await signIn.mfa.verifyEmailCode({ code: code.trim() })
          : secondFactorStrategy === "phone_code"
            ? await signIn.mfa.verifyPhoneCode({ code: code.trim() })
            : secondFactorStrategy === "totp"
              ? await signIn.mfa.verifyTOTP({ code: code.trim() })
              : await signIn.mfa.verifyBackupCode({ code: code.trim() });
      if (result?.error) {
        showAlert(
          "Verification failed",
          getErrorMessage(result.error, "The code was not accepted."),
        );
        return;
      }

      if (signIn.status === "complete") {
        await finalizeSession();
      } else {
        showAlert(
          "Verification incomplete",
          `Status: ${signIn.status ?? "unknown"}`,
        );
      }
    } catch (err: any) {
      showAlert(
        "Verification failed",
        getErrorMessage(err, "The code was not accepted."),
      );
    } finally {
      setActionLoading(false);
    }
  };

  const resendCode = async () => {
    if (
      (secondFactorStrategy !== "email_code" &&
        secondFactorStrategy !== "phone_code") ||
      actionLoading
    ) {
      return;
    }
    setActionLoading(true);
    try {
      const result =
        secondFactorStrategy === "email_code"
          ? await signIn.mfa.sendEmailCode()
          : await signIn.mfa.sendPhoneCode();
      if (result?.error) {
        showAlert(
          "Could not resend code",
          getErrorMessage(result.error, "Please try again."),
        );
        return;
      }
      showAlert(
        "Code sent",
        secondFactorStrategy === "email_code"
          ? "A new verification code has been sent to your email."
          : "A new verification code has been sent by SMS.",
      );
    } catch (err: any) {
      showAlert(
        "Could not resend code",
        getErrorMessage(err, "Please try again."),
      );
    } finally {
      setActionLoading(false);
    }
  };

  const resetVerification = async () => {
    try {
      const { error } = await signIn.reset();
      if (error) {
        showAlert("Could not start over", getErrorMessage(error, "Please try again."));
        return;
      }
      setVerificationMode(null);
      setSecondFactorStrategy(null);
      setCode("");
    } catch (err: any) {
      showAlert("Could not start over", getErrorMessage(err, "Please try again."));
    }
  };

  const switchFactor = async (strategy: string) => {
    if (strategy === "email_link") {
      showAlert(
        "Email link unavailable",
        "Email-link verification is not supported in this native sign-in screen. Choose another available method.",
      );
      return;
    }
    if (verificationMode) {
      await startSecondFactor(verificationMode, strategy);
    }
  };

  const isLoading = fetchStatus === "fetching" || actionLoading;
  const canSubmit = emailAddress.length > 0 && password.length > 0 && !isLoading;
  const supportedSecondFactors = (signIn.supportedSecondFactors ?? []) as Array<{
    strategy: string;
    safeIdentifier?: string;
  }>;

  if (signIn.status === "complete") {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.finalizeContainer}>
          {finalizeFailed ? (
            <>
              <Text style={styles.title}>Almost done</Text>
              <Text style={styles.trustBody}>
                Your credentials were verified, but the session could not be
                saved on this device.
              </Text>
              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  styles.finalizeButton,
                  pressed && styles.buttonPressed,
                ]}
                onPress={finalizeSession}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.buttonText}>Try again</Text>
                )}
              </Pressable>
              <Pressable style={styles.trustBack} onPress={resetVerification}>
                <Text style={styles.trustBackText}>← Start over</Text>
              </Pressable>
            </>
          ) : (
            <>
              <ActivityIndicator size="large" color="#1B5E20" />
              <Text style={styles.trustBody}>Finishing sign in…</Text>
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  if (verificationMode && secondFactorStrategy) {
    const factorTitle =
      verificationMode === "client_trust"
        ? "Verify this device"
        : "Two-step verification";
    const factorDescription =
      secondFactorStrategy === "email_code"
        ? "Enter the code sent to your email to approve this sign-in."
        : secondFactorStrategy === "phone_code"
          ? "Enter the code sent to your phone to approve this sign-in."
          : secondFactorStrategy === "totp"
            ? "Enter the code from your authenticator app."
            : "Enter one of your saved backup codes.";
    return (
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <ScrollView
            contentContainerStyle={styles.trustContainer}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.trustIconWrap}>
              <Feather name="shield" size={40} color="#1B5E20" />
            </View>
            <Text style={styles.trustTitle}>{factorTitle}</Text>
            <Text style={styles.trustBody}>{factorDescription}</Text>

            <View style={styles.factorPill}>
              <Text style={styles.factorPillText}>
                {factorLabel(secondFactorStrategy)}
              </Text>
            </View>

            <View style={styles.verificationForm}>
              <TextInput
                style={[styles.input, !!errors.fields.code && styles.inputError]}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType={
                  secondFactorStrategy === "backup_code"
                    ? "default"
                    : "number-pad"
                }
                placeholder={
                  secondFactorStrategy === "backup_code"
                    ? "Enter backup code"
                    : "Enter verification code"
                }
                placeholderTextColor="#9CA3AF"
                value={code}
                onChangeText={setCode}
                maxLength={secondFactorStrategy === "backup_code" ? 32 : 8}
              />
              {!!errors.fields.code && (
                <Text style={styles.fieldError}>
                  {errors.fields.code.message}
                </Text>
              )}
              {!!errors.global?.length && (
                <View style={styles.globalError}>
                  <Text style={styles.globalErrorText}>
                    {errors.global?.[0]?.longMessage ??
                      errors.global?.[0]?.message}
                  </Text>
                </View>
              )}
              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  (!code.trim() || isLoading) && styles.buttonDisabled,
                  pressed && code.trim() && !isLoading && styles.buttonPressed,
                ]}
                onPress={handleVerify}
                disabled={!code.trim() || isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.buttonText}>Verify</Text>
                )}
              </Pressable>
              {(secondFactorStrategy === "email_code" ||
                secondFactorStrategy === "phone_code") && (
                <Pressable
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={resendCode}
                  disabled={isLoading}
                >
                  <Text style={styles.secondaryButtonText}>Resend code</Text>
                </Pressable>
              )}
            </View>

            {supportedSecondFactors.length > 1 && (
              <View style={styles.factorOptions}>
                <Text style={styles.factorOptionsTitle}>Use another method</Text>
                {supportedSecondFactors.map((factor) => (
                  <Pressable
                    key={factor.strategy}
                    style={styles.factorOption}
                    onPress={() => switchFactor(factor.strategy)}
                    disabled={isLoading || factor.strategy === secondFactorStrategy}
                  >
                    <Text
                      style={[
                        styles.factorOptionText,
                        factor.strategy === secondFactorStrategy &&
                          styles.factorOptionSelected,
                      ]}
                    >
                      {factorLabel(factor.strategy)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

            <Pressable style={styles.trustBack} onPress={resetVerification}>
              <Text style={styles.trustBackText}>← Back to sign in</Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

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
            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.subtitle}>Sign in to your Dodolink account</Text>
          </View>

          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={styles.label}>Email address</Text>
              <TextInput
                style={[
                  styles.input,
                  !!errors.fields.identifier && styles.inputError,
                ]}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                placeholder="you@example.com"
                placeholderTextColor="#9CA3AF"
                value={emailAddress}
                onChangeText={setEmailAddress}
              />
              {!!errors.fields.identifier && (
                <Text style={styles.fieldError}>
                  {errors.fields.identifier.message}
                </Text>
              )}
            </View>

            <View style={styles.field}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>Password</Text>
                <Link href="/(auth)/forgot-password" asChild>
                  <Pressable>
                    <Text style={styles.forgotLink}>Forgot password?</Text>
                  </Pressable>
                </Link>
              </View>
              <View style={styles.passwordContainer}>
                <TextInput
                  style={[
                    styles.input,
                    styles.passwordInput,
                    !!errors.fields.password && styles.inputError,
                  ]}
                  secureTextEntry={!showPassword}
                  textContentType="password"
                  placeholder="Enter your password"
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
                <Text style={styles.fieldError}>
                  {errors.fields.password.message}
                </Text>
              )}
            </View>

            {!!errors.global?.length && (
              <View style={styles.globalError}>
                <Text style={styles.globalErrorText}>{errors.global?.[0]?.longMessage ?? errors.global?.[0]?.message}</Text>
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
                <Text style={styles.buttonText}>Sign in</Text>
              )}
            </Pressable>
          </View>

          {Platform.OS === "ios" && APPLE_SIGN_IN_ENABLED && (
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
            <Text style={styles.footerText}>Don't have an account? </Text>
            <Link href="/(auth)/sign-up" asChild>
              <Pressable>
                <Text style={styles.footerLink}>Sign up</Text>
              </Pressable>
            </Link>
          </View>

          <View style={styles.legalRow}>
            <Pressable onPress={() => WebBrowser.openBrowserAsync(TERMS_URL)} hitSlop={6}>
              <Text style={styles.legalLink}>Terms of Service</Text>
            </Pressable>
            <Text style={styles.legalText}> · </Text>
            <Pressable onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL)} hitSlop={6}>
              <Text style={styles.legalLink}>Privacy Policy</Text>
            </Pressable>
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
  form: { gap: 16 },
  field: { gap: 6 },
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
    color: "#374151",
    fontFamily: "Inter_500Medium",
  },
  forgotLink: {
    fontSize: 13,
    color: "#1B5E20",
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
  trustContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 20,
  },
  trustIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: "#DCFCE7",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  trustTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#111827",
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  trustBody: {
    fontSize: 15,
    color: "#6B7280",
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 22,
  },
  trustBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1B5E20",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    marginTop: 8,
  },
  trustBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  trustBack: {
    marginTop: 8,
    padding: 8,
  },
  trustBackText: {
    fontSize: 14,
    color: "#6B7280",
    fontFamily: "Inter_400Regular",
  },
  verificationForm: {
    width: "100%",
    gap: 12,
  },
  finalizeContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 16,
  },
  finalizeButton: {
    alignSelf: "stretch",
  },
  factorPill: {
    borderRadius: 999,
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  factorPillText: {
    color: "#166534",
    fontSize: 13,
    fontFamily: "Inter_500Medium",
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
  factorOptions: {
    width: "100%",
    marginTop: 4,
    gap: 8,
  },
  factorOptionsTitle: {
    fontSize: 13,
    color: "#6B7280",
    fontFamily: "Inter_500Medium",
    textAlign: "center",
  },
  factorOption: {
    alignItems: "center",
    paddingVertical: 8,
  },
  factorOptionText: {
    color: "#1B5E20",
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  factorOptionSelected: {
    color: "#9CA3AF",
  },
  legalRow: {
    flexDirection: "row",
    justifyContent: "center",
    flexWrap: "wrap",
    marginTop: 16,
  },
  legalText: {
    fontSize: 12,
    color: "#9CA3AF",
    fontFamily: "Inter_400Regular",
  },
  legalLink: {
    fontSize: 12,
    color: "#1B5E20",
    fontFamily: "Inter_500Medium",
    fontWeight: "500",
  },
});
