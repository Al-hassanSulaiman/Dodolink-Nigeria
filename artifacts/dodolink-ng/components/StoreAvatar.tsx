import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useUpdateStore, type Store } from "@workspace/api-client-react";
import { uploadImageToStorage, getImageUrl } from "@/utils/storage";
import { useQueryClient } from "@tanstack/react-query";

interface StoreAvatarProps {
  store: Store;
  size?: number;
  editable?: boolean;
}

export function StoreAvatar({ store, size = 64, editable = false }: StoreAvatarProps) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [localUri, setLocalUri] = useState<string | null>(null);

  const updateStore = useUpdateStore({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["listStores"] });
        queryClient.invalidateQueries({ queryKey: ["getStore", store.id] });
      },
    },
  });

  const initial = store.name ? store.name.charAt(0).toUpperCase() : "?";
  const storedUrl = store.imageUrl ? getImageUrl(store.imageUrl) : null;
  const photoUri = localUri ?? storedUrl;

  const handlePress = async () => {
    if (!editable || uploading) return;

    if (Platform.OS !== "web") {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission needed",
          "Please allow access to your photo library to set a store photo."
        );
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
    });

    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setLocalUri(asset.uri);
    setUploading(true);
    try {
      const objectPath = await uploadImageToStorage(asset.uri);
      await updateStore.mutateAsync({ storeId: store.id, data: { imageUrl: objectPath } });
    } catch {
      setLocalUri(null);
      Alert.alert("Upload failed", "Could not update the store photo. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const radius = size / 2;
  const cameraSize = Math.round(size * 0.32);
  const badgeSize = Math.round(size * 0.38);

  const avatar = (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: radius, backgroundColor: colors.primary },
      ]}
    >
      {photoUri ? (
        <Image source={{ uri: photoUri }} style={[styles.photo, { borderRadius: radius }]} />
      ) : (
        <Text style={[styles.initial, { fontSize: size * 0.38, color: colors.primaryForeground }]}>
          {initial}
        </Text>
      )}

      {uploading && (
        <View style={[styles.overlay, { borderRadius: radius }]}>
          <ActivityIndicator color="#fff" size="small" />
        </View>
      )}

      {editable && !uploading && (
        <View
          style={[
            styles.badge,
            {
              width: badgeSize,
              height: badgeSize,
              borderRadius: badgeSize / 2,
              backgroundColor: colors.accent,
              bottom: 0,
              right: 0,
            },
          ]}
        >
          <Feather name="camera" size={cameraSize} color="#fff" />
        </View>
      )}
    </View>
  );

  if (!editable) return avatar;

  return (
    <Pressable
      onPress={handlePress}
      disabled={uploading}
      style={({ pressed }) => [pressed && { opacity: 0.8 }]}
    >
      {avatar}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  photo: {
    width: "100%",
    height: "100%",
    position: "absolute",
  },
  initial: {
    fontFamily: "Inter_700Bold",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
});
