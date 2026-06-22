import { useState } from 'react';
import { StyleSheet, View, Text, Image, ScrollView, Pressable, Alert, ActivityIndicator, Platform } from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useCreateProduct } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { Input, Button } from '@/components/ui';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { uploadImageToStorage } from '@/utils/storage';

const MAX_IMAGES = 5;

export default function AddProductScreen() {
  const { storeId } = useLocalSearchParams<{ storeId: string }>();
  const id = parseInt(storeId, 10);
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priceStr, setPriceStr] = useState('');
  const [category, setCategory] = useState('');
  const [localImages, setLocalImages] = useState<string[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);

  const createProduct = useCreateProduct({
    mutation: {
      onSuccess: () => {
        router.back();
      }
    }
  });

  const pickImages = async () => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow access to your photo library to upload images.');
        return;
      }
    }

    const remaining = MAX_IMAGES - localImages.length;
    if (remaining <= 0) {
      Alert.alert('Limit reached', `You can upload up to ${MAX_IMAGES} images.`);
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.8,
      selectionLimit: remaining,
    });

    if (!result.canceled && result.assets.length > 0) {
      const newUris = result.assets.map(a => a.uri);
      setLocalImages(prev => [...prev, ...newUris].slice(0, MAX_IMAGES));
    }
  };

  const removeImage = (index: number) => {
    setLocalImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!name || !priceStr || !category) return;

    let imageUrls: string[] = [];

    if (localImages.length > 0) {
      setUploadingImages(true);
      try {
        imageUrls = await Promise.all(localImages.map(uploadImageToStorage));
      } catch {
        Alert.alert('Upload failed', 'Could not upload one or more images. Please try again.');
        setUploadingImages(false);
        return;
      } finally {
        setUploadingImages(false);
      }
    }

    createProduct.mutate({
      storeId: id,
      data: {
        name,
        description,
        price: parseFloat(priceStr),
        category,
        imageUrls,
        imageUrl: imageUrls[0] ?? null,
        inStock: true,
      }
    });
  };

  const isPending = uploadingImages || createProduct.isPending;
  const submitLabel = uploadingImages
    ? 'Uploading images...'
    : createProduct.isPending
      ? 'Adding product...'
      : 'Add Product';

  return (
    <View style={StyleSheet.flatten([styles.container, { backgroundColor: colors.background }])}>
      <Stack.Screen options={{ title: 'Add Product' }} />
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={StyleSheet.flatten([styles.content, { paddingBottom: insets.bottom + 20 }])}
        bottomOffset={20}
      >
        <Text style={[styles.sectionLabel, { color: colors.foreground }]}>
          Product Photos
        </Text>
        <Text style={[styles.sectionHint, { color: colors.mutedForeground }]}>
          First photo will be the thumbnail. Up to {MAX_IMAGES} photos.
        </Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.imageRow}
        >
          {localImages.map((uri, index) => (
            <View key={uri} style={styles.imageSlot}>
              <Image source={{ uri }} style={styles.imageThumb} resizeMode="cover" />
              {index === 0 && (
                <View style={StyleSheet.flatten([styles.thumbnailBadge, { backgroundColor: colors.primary }])}>
                  <Text style={styles.thumbnailBadgeText}>Cover</Text>
                </View>
              )}
              <Pressable
                style={StyleSheet.flatten([styles.removeBtn, { backgroundColor: colors.destructive }])}
                onPress={() => removeImage(index)}
                hitSlop={8}
              >
                <Feather name="x" size={12} color="#fff" />
              </Pressable>
            </View>
          ))}

          {localImages.length < MAX_IMAGES && (
            <Pressable
              style={StyleSheet.flatten([styles.addImageBtn, { borderColor: colors.border, backgroundColor: colors.muted }])}
              onPress={pickImages}
            >
              {uploadingImages ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  <Feather name="camera" size={24} color={colors.mutedForeground} />
                  <Text style={[styles.addImageLabel, { color: colors.mutedForeground }]}>
                    {localImages.length === 0 ? 'Add Photos' : 'Add More'}
                  </Text>
                </>
              )}
            </Pressable>
          )}
        </ScrollView>

        <Text style={[styles.label, { color: colors.foreground, marginTop: 20 }]}>Product Name</Text>
        <Input placeholder="e.g. iPhone 13 Pro Max" value={name} onChangeText={setName} />

        <Text style={[styles.label, { color: colors.foreground, marginTop: 16 }]}>Price (₦)</Text>
        <Input placeholder="e.g. 500000" value={priceStr} onChangeText={setPriceStr} keyboardType="numeric" />

        <Text style={[styles.label, { color: colors.foreground, marginTop: 16 }]}>Category</Text>
        <Input placeholder="e.g. Smartphones" value={category} onChangeText={setCategory} />

        <Text style={[styles.label, { color: colors.foreground, marginTop: 16 }]}>Description</Text>
        <Input
          placeholder="Describe the product details..."
          value={description}
          onChangeText={setDescription}
          multiline
          style={styles.textArea}
        />

        <View style={styles.buttonContainer}>
          <Button
            title={submitLabel}
            onPress={handleSubmit}
            disabled={!name || !priceStr || !category || isPending}
          />
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  sectionLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    marginBottom: 4,
  },
  sectionHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    marginBottom: 12,
  },
  imageRow: {
    flexDirection: 'row',
    gap: 10,
    paddingBottom: 4,
  },
  imageSlot: {
    position: 'relative',
    width: 90,
    height: 90,
    borderRadius: 10,
    overflow: 'hidden',
  },
  imageThumb: {
    width: 90,
    height: 90,
    borderRadius: 10,
  },
  thumbnailBadge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: 3,
    alignItems: 'center',
  },
  thumbnailBadgeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    color: '#fff',
  },
  removeBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addImageBtn: {
    width: 90,
    height: 90,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  addImageLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
  },
  label: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    marginBottom: 8,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
    paddingTop: 12,
  },
  buttonContainer: {
    marginTop: 32,
  },
});
