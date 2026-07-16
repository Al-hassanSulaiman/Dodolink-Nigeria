import { useUser } from "@clerk/expo";

export function useUserIdentity() {
  const { user, isLoaded } = useUser();

  const userId = user?.id ?? null;
  const userName =
    user?.fullName ||
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.primaryEmailAddress?.emailAddress?.split("@")[0] ||
    "User";

  const updateUserName = async (name: string) => {
    if (!user) return;
    const parts = name.trim().split(/\s+/);
    const firstName = parts[0] ?? "";
    const lastName = parts.slice(1).join(" ") || undefined;
    await user.update({ firstName, lastName });
  };

  return { userId, userName, updateUserName, isReady: isLoaded };
}
