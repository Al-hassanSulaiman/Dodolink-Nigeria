import { useSignIn, useClerk } from "@clerk/expo";
import { type Href, Link, useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Alert,
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
import { Feather } from "@expo/vector-icons";

function NativeAnchor({ href, children, style }: { href: string; children: React.ReactNode; style?: object }) {
  if (Platform.OS !== "web") return null;
  return React.createElement("a", {
    href,
    target: "_blank",
    rel: "noopener noreferrer",
    style: {
      display: "flex",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#1B5E20",
      borderRadius: 12,
      paddingTop: 14,
      paddingBottom: 14,
      paddingLeft: 24,
      paddingRight: 24,
      textDecoration: "none",
      gap: 8,
      ...style,
    },
  }, children);
}

function buildSyncUrl(clerk: any): string | null {
  let frontendApi: string | undefined =
    clerk?.frontendApi ??
    clerk?.__unstable__environment?.displayConfig?.homeUrl;
  if (!frontendApi) {
    try {
      const pk: string = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
      const raw = pk.replace(/^pk_(test|live)_/, "");
      const pad = raw + "=".repeat((4 - (raw.length % 4)) % 4);
      frontendApi = atob(pad).replace(/\.$/, "");
    } catch {}
  }
  if (!frontendApi) return null;
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  return `https://${frontendApi}/v1/client/sync?redirect_url=${encodeURIComponent(origin)}`;
}

export default function SignInPage() {
  const { signIn, setActive, errors, fetchStatus } = useSignIn() as any;
  const clerk = useClerk() as any;
  const router = useRouter();

  const [emailAddress, setEmailAddress] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [syncUrl, setSyncUrl] = React.useState<string | null>(null);

  const handleSubmit = async () => {
    try {
      const { data, error } = await signIn.password({ emailAddress, password });
      if (error) return;

      const result = data ?? signIn;

      if (result.status === "complete") {
        if (setActive) {
          await setActive({ session: result.createdSessionId });
        }
        router.replace("/(tabs)" as Href);
      } else if (result.status === "needs_client_trust") {
        setSyncUrl(buildSyncUrl(clerk));
      } else {
        Alert.alert("Sign in incomplete", `Status: ${result.status ?? "unknown"}`);
      }
    } catch (err: any) {
      const msg = err?.errors?.[0]?.longMessage ?? err?.message ?? String(err);
      Alert.alert("Sign in error", msg);
    }
  };

  const isLoading = fetchStatus === "fetching";
  const canSubmit = emailAddress.length > 0 && password.length > 0 && !isLoading;

  if (syncUrl) {
    const appUrl = typeof window !== "undefined" ? window.location.origin : "";
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.trustContainer}>
          <View style={styles.trustIconWrap}>
            <Feather name="shield" size={40} color="#1B5E20" />
          </View>
          <Text style={styles.trustTitle}>One-time setup required</Text>
          <Text style={styles.trustBody}>
            The preview is sandboxed — authentication needs to happen outside
            it. Copy the URL below and open it in a new browser tab. Sign in
            there, then come back here and sign in again.
          </Text>

          <View style={styles.urlBox}>
            <Text style={styles.urlLabel}>Your app URL</Text>
            <TextInput
              style={styles.urlInput}
              value={appUrl}
              editable={false}
              selectTextOnFocus
            />
            <Pressable
              style={styles.copyBtn}
              onPress={() => {
                if (typeof navigator !== "undefined" && navigator.clipboard) {
                  navigator.clipboard.writeText(appUrl).then(() =>
                    Alert.alert("Copied!", "URL copied to clipboard.")
                  );
                }
              }}
            >
              <Feather name="copy" size={14} color="#1B5E20" />
              <Text style={styles.copyBtnText}>Copy URL</Text>
            </Pressable>
          </View>

          <NativeAnchor href={appUrl}>
            {React.createElement("span", {
              style: { color: "#fff", fontSize: 15, fontWeight: "600" },
            }, "Open in new tab ↗")}
          </NativeAnchor>

          <Pressable style={styles.trustBack} onPress={() => setSyncUrl(null)}>
            <Text style={styles.trustBackText}>← Back to sign in</Text>
          </Pressable>
        </ScrollView>
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

            {errors.global && (
              <View style={styles.globalError}>
                <Text style={styles.globalErrorText}>{errors.global.message}</Text>
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

          <View style={styles.footer}>
            <Text style={styles.footerText}>Don't have an account? </Text>
            <Link href="/(auth)/sign-up" asChild>
              <Pressable>
                <Text style={styles.footerLink}>Sign up</Text>
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
  urlBox: {
    width: "100%",
    gap: 6,
  },
  urlLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: "#374151",
    fontFamily: "Inter_500Medium",
  },
  urlInput: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: "#111827",
    backgroundColor: "#F9FAFB",
    fontFamily: "Inter_400Regular",
  },
  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    backgroundColor: "#fff",
  },
  copyBtnText: {
    fontSize: 13,
    color: "#1B5E20",
    fontFamily: "Inter_500Medium",
    fontWeight: "500",
  },
});
