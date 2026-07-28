import { useUser } from "@clerk/expo";

export function useUserIdentity() {
  const { user, isLoaded } = useUser();

  const userId = user?.id ?? null;
  const userEmail = user?.primaryEmailAddress?.emailAddress ?? null;
  const userName =
    user?.fullName ||
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    userEmail?.split("@")[0] ||
    "User";

  const imageUrl = user?.imageUrl ?? null;

  const updateUserName = async (name: string) => {
    if (!user) return;
    const parts = name.trim().split(/\s+/);
    const firstName = parts[0] ?? "";
    const lastName = parts.slice(1).join(" ") || undefined;
    await user.update({ firstName, lastName });
  };

  const updateProfileImage = async (uri: string, mimeType = "image/jpeg") => {
    if (!user) return;
    const file = {
      uri,
      name: `avatar.${mimeType.split("/")[1] ?? "jpg"}`,
      type: mimeType,
    } as unknown as File;
    await user.setProfileImage({ file });
  };

  return { userId, userName, userEmail, imageUrl, updateUserName, updateProfileImage, isReady: isLoaded };
}
