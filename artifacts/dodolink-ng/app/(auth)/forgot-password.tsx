import { useSignIn } from "@clerk/expo";
import { type Href, useRouter } from "expo-router";
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
import { SafeAreaView } from "react-native-safe-area-context";

type Step = "email" | "code" | "password" | "done";

export default function ForgotPasswordPage() {
  const { signIn, errors, fetchStatus } = useSignIn();
  const router = useRouter();

  const [step, setStep] = React.useState<Step>("email");
  const [emailAddress, setEmailAddress] = React.useState("");
  const [code, setCode] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [passwordMismatch, setPasswordMismatch] = React.useState(false);

  const isLoading = fetchStatus === "fetching";

  const handleSendCode = async () => {
    const { error } = await signIn.create({ identifier: emailAddress });
    if (error) return;
    const { error: sendError } = await signIn.resetPasswordEmailCode.sendCode();
    if (sendError) return;
    setStep("code");
  };

  const handleVerifyCode = async () => {
    const { error } = await signIn.resetPasswordEmailCode.verifyCode({ code });
    if (error) return;
    setStep("password");
  };

  const handleResetPassword = async () => {
    if (newPassword !== confirmPassword) {
      setPasswordMismatch(true);
      return;
    }
    setPasswordMismatch(false);
    const { error } = await signIn.resetPasswordEmailCode.submitPassword({
      password: newPassword,
      signOutOfOtherSessions: true,
    });
    if (error) return;
    if (signIn.status === "complete") {
      setStep("done");
      await signIn.finalize({
        navigate: ({ decorateUrl }) => {
          const url = decorateUrl("/");
          if (url.startsWith("http")) {
            (globalThis as any).location
              ? (globalThis as any).location.assign(url)
              : router.replace("/(tabs)" as Href);
          } else {
            router.replace("/(tabs)" as Href);
          }
        },
      });
    }
  };

  if (step === "done") {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centeredContainer}>
          <View style={styles.successIcon}>
            <Text style={styles.successIconText}>✓</Text>
          </View>
          <Text style={styles.title}>Password updated!</Text>
          <Text style={styles.subtitle}>Your password has been reset successfully.</Text>
          <Pressable
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={() => router.replace("/(tabs)" as Href)}
          >
            <Text style={styles.buttonText}>Continue to app</Text>
          </Pressable>
        </View>
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
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backText}>← Back</Text>
          </Pressable>

          <View style={styles.header}>
            <View style={styles.logoMark}>
              <Text style={styles.logoText}>D</Text>
            </View>
            {step === "email" && (
              <>
                <Text style={styles.title}>Reset password</Text>
                <Text style={styles.subtitle}>
                  Enter your email to receive a reset code
                </Text>
              </>
            )}
            {step === "code" && (
              <>
                <Text style={styles.title}>Enter code</Text>
                <Text style={styles.subtitle}>
                  We sent a reset code to{"\n"}
                  <Text style={styles.emailHighlight}>{emailAddress}</Text>
                </Text>
              </>
            )}
            {step === "password" && (
              <>
                <Text style={styles.title}>New password</Text>
                <Text style={styles.subtitle}>Choose a strong new password</Text>
              </>
            )}
          </View>

          <View style={styles.form}>
            {step === "email" && (
              <>
                <View style={styles.field}>
                  <Text style={styles.label}>Email address</Text>
                  <TextInput
                    style={[styles.input, !!errors.fields.identifier && styles.inputError]}
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
                    <Text style={styles.fieldError}>{errors.fields.identifier.message}</Text>
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
                    (!emailAddress || isLoading) && styles.buttonDisabled,
                    pressed && emailAddress && !isLoading && styles.buttonPressed,
                  ]}
                  onPress={handleSendCode}
                  disabled={!emailAddress || isLoading}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.buttonText}>Send reset code</Text>
                  )}
                </Pressable>
              </>
            )}

            {step === "code" && (
              <>
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
                  onPress={handleVerifyCode}
                  disabled={!code || isLoading}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.buttonText}>Verify code</Text>
                  )}
                </Pressable>

                <Pressable
                  style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
                  onPress={() => signIn.resetPasswordEmailCode.sendCode()}
                >
                  <Text style={styles.secondaryButtonText}>Resend code</Text>
                </Pressable>
              </>
            )}

            {step === "password" && (
              <>
                <View style={styles.field}>
                  <Text style={styles.label}>New password</Text>
                  <TextInput
                    style={[styles.input, !!errors.fields.password && styles.inputError]}
                    secureTextEntry
                    textContentType="newPassword"
                    placeholder="At least 8 characters"
                    placeholderTextColor="#9CA3AF"
                    value={newPassword}
                    onChangeText={(v) => {
                      setNewPassword(v);
                      setPasswordMismatch(false);
                    }}
                  />
                  {!!errors.fields.password && (
                    <Text style={styles.fieldError}>{errors.fields.password.message}</Text>
                  )}
                </View>

                <View style={styles.field}>
                  <Text style={styles.label}>Confirm password</Text>
                  <TextInput
                    style={[styles.input, passwordMismatch && styles.inputError]}
                    secureTextEntry
                    textContentType="newPassword"
                    placeholder="Re-enter new password"
                    placeholderTextColor="#9CA3AF"
                    value={confirmPassword}
                    onChangeText={(v) => {
                      setConfirmPassword(v);
                      setPasswordMismatch(false);
                    }}
                  />
                  {passwordMismatch && (
                    <Text style={styles.fieldError}>Passwords do not match</Text>
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
                    (!newPassword || !confirmPassword || isLoading) && styles.buttonDisabled,
                    pressed && newPassword && confirmPassword && !isLoading && styles.buttonPressed,
                  ]}
                  onPress={handleResetPassword}
                  disabled={!newPassword || !confirmPassword || isLoading}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.buttonText}>Update password</Text>
                  )}
                </Pressable>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F9FAFB" },
  flex: { flex: 1 },
  centeredContainer: {
    flex: 1,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 32,
    justifyContent: "center",
  },
  backButton: { marginBottom: 24 },
  backText: {
    fontSize: 15,
    color: "#1B5E20",
    fontFamily: "Inter_500Medium",
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
  successIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#DCFCE7",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  successIconText: { fontSize: 32, color: "#1B5E20" },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#111827",
    fontFamily: "Inter_700Bold",
    marginBottom: 8,
    textAlign: "center",
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
});
