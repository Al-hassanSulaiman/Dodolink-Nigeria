import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useAuth } from "@clerk/expo";
import { useColors } from "@/hooks/useColors";
import { useToggleFollow } from "@/hooks/useHomeFeed";

export function formatCount(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

interface Props {
  storeId: number;
  isFollowing: boolean;
  followerCount?: number;
  isOwner?: boolean;
  returnTo?: string;
  compact?: boolean;
  showCount?: boolean;
}

export function FollowButton({ storeId, isFollowing, followerCount, isOwner, returnTo, compact, showCount }: Props) {
  const colors = useColors();
  const { isSignedIn } = useAuth();
  const toggle = useToggleFollow();
  const [error, setError] = useState("");

  const countLabel = followerCount !== undefined
    ? `${formatCount(followerCount)} ${followerCount === 1 ? "follower" : "followers"}`
    : "";

  if (isOwner) {
    return showCount && countLabel ? (
      <View style={[styles.ownerPill, { backgroundColor: colors.secondary }]}>
        <Feather name="users" size={13} color={colors.secondaryForeground} />
        <Text style={[styles.ownerText, { color: colors.secondaryForeground }]}>{countLabel}</Text>
      </View>
    ) : null;
  }

  const onPress = () => {
    if (toggle.isPending) return;
    setError("");
    if (!isSignedIn) {
      router.push({ pathname: "/(auth)/sign-in", params: returnTo ? { returnTo } : {} });
      return;
    }
    toggle.mutate({ storeId, follow: !isFollowing }, {
      onError: () => setError(isFollowing ? "Couldn't unfollow. Try again." : "Couldn't follow. Try again."),
    });
  };

  const filled = !isFollowing;
  return (
    <View style={compact ? undefined : styles.wrap}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy: toggle.isPending, selected: isFollowing }}
          accessibilityLabel={isFollowing ? "Unfollow store" : "Follow store"}
          onPress={onPress}
          disabled={toggle.isPending}
          hitSlop={6}
          style={({ pressed }) => [
            compact ? styles.compactBtn : styles.btn,
            filled
              ? { backgroundColor: colors.primary, borderColor: colors.primary }
              : { backgroundColor: "transparent", borderColor: colors.border },
            pressed && { opacity: 0.75 },
          ]}
        >
          {toggle.isPending ? (
            <ActivityIndicator size="small" color={filled ? colors.primaryForeground : colors.primary} />
          ) : (
            <>
              <Feather name={isFollowing ? "check" : "user-plus"} size={compact ? 12 : 15} color={filled ? colors.primaryForeground : colors.foreground} />
              <Text style={[compact ? styles.compactText : styles.text, { color: filled ? colors.primaryForeground : colors.foreground }]}>
                {isFollowing ? "Following" : "Follow"}
              </Text>
            </>
          )}
        </Pressable>
        {showCount && !!countLabel && <Text style={[styles.count, { color: colors.mutedForeground }]}>{countLabel}</Text>}
      </View>
      {!!error && <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minWidth: 116, height: 40, paddingHorizontal: 18, borderRadius: 20, borderWidth: 1.5 },
  compactBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, height: 28, minWidth: 72, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1 },
  text: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  compactText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  count: { fontFamily: "Inter_500Medium", fontSize: 13 },
  error: { fontFamily: "Inter_400Regular", fontSize: 12 },
  ownerPill: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14 },
  ownerText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
});
