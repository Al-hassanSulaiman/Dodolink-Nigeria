import { useState, useEffect } from 'react';
import { StyleSheet, View, Text, Image, ScrollView, Pressable, ActivityIndicator, Platform, Switch } from 'react-native';
import { showAlert } from '@/utils/alerts';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useGetProduct, useUpdateProduct, getGetProductQueryKey, getListStoreProductsQueryKey, getListProductsQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { Input, Button } from '@/components/ui';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { uploadImageToStorage, getImageUrl } from '@/utils/storage';
import { LoadingScreen } from '@/components/Loading';

const MAX_IMAGES = 5;

export default function EditProductScreen() {
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const id = parseInt(productId, 10);
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priceStr, setPriceStr] = useState('');
  const [category, setCategory] = useState('');
  const [inStock, setInStock] = useState(true);

  // Existing image URLs already stored in object storage
  const [existingUrls, setExistingUrls] = useState<string[]>([]);
  // Newly picked local URIs not yet uploaded
  const [newLocalImages, setNewLocalImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const { data: product, isLoading } = useGetProduct(id, {
    query: { enabled: !!id, queryKey: getGetProductQueryKey(id) }
  });

  const queryClient = useQueryClient();

  const updateProduct = useUpdateProduct({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetProductQueryKey(id) });
        if (product?.storeId) {
          queryClient.invalidateQueries({ queryKey: getListStoreProductsQueryKey(product.storeId) });
        }
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
        router.back();
      }
    }
  });

  // Populate form once product loads
  useEffect(() => {
    if (product && !initialized) {
      setName(product.name);
      setDescription(product.description ?? '');
      setPriceStr(String(product.price));
      setCategory(product.category);
      setInStock(product.inStock);
      // Merge legacy imageUrl into imageUrls so owners see all existing images
      const urls = product.imageUrls ?? [];
      if (urls.length === 0 && product.imageUrl) {
        setExistingUrls([product.imageUrl]);
      } else {
        setExistingUrls(urls);
      }
      setInitialized(true);
    }
  }, [product, initialized]);

  if (isLoading || !initialized) return <LoadingScreen message="Loading product..." />;
  if (!product) return null;

  const totalImages = existingUrls.length + newLocalImages.length;

  const pickImages = async () => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        showAlert('Permission needed', 'Please allow access to your photo library to upload images.');
        return;
      }
    }

    const remaining = MAX_IMAGES - totalImages;
    if (remaining <= 0) {
      showAlert('Limit reached', `You can have up to ${MAX_IMAGES} images.`);
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.8,
      selectionLimit: remaining,
    });

    if (!result.canceled && result.assets.length > 0) {
      const uris = result.assets.map(a => a.uri);
      setNewLocalImages(prev => [...prev, ...uris].slice(0, MAX_IMAGES - existingUrls.length));
    }
  };

  const removeExisting = (index: number) => {
    setExistingUrls(prev => prev.filter((_, i) => i !== index));
  };

  const removeNew = (index: number) => {
    setNewLocalImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!name || !priceStr || !category) return;

    let uploadedUrls: string[] = [];
    if (newLocalImages.length > 0) {
      setUploading(true);
      try {
        uploadedUrls = await Promise.all(newLocalImages.map(uploadImageToStorage));
      } catch {
        showAlert('Upload failed', 'Could not upload one or more images. Please try again.');
        setUploading(false);
        return;
      } finally {
        setUploading(false);
      }
    }

    const imageUrls = [...existingUrls, ...uploadedUrls];
    updateProduct.mutate({
      productId: id,
      data: {
        name,
        description,
        price: parseFloat(priceStr),
        category,
        inStock,
        imageUrls,
        imageUrl: imageUrls[0] ?? null,
      }
    });
  };

  const isPending = uploading || updateProduct.isPending;
  const submitLabel = uploading
    ? 'Uploading images...'
    : updateProduct.isPending
      ? 'Saving...'
      : 'Save Changes';

  const coverIndex = 0; // first image is always cover

  return (
    <View style={StyleSheet.flatten([styles.container, { backgroundColor: colors.background }])}>
      <Stack.Screen options={{ title: 'Edit Product' }} />
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={StyleSheet.flatten([styles.content, { paddingBottom: insets.bottom + 20 }])}
        bottomOffset={20}
      >
        {/* ── Image section ────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Product Photos</Text>
        <Text style={[styles.sectionHint, { color: colors.mutedForeground }]}>
          First photo is the cover. Up to {MAX_IMAGES} photos.
        </Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.imageRow}
        >
          {/* Existing stored images */}
          {existingUrls.map((url, index) => (
            <View key={`existing-${index}`} style={styles.imageSlot}>
              <Image
                source={{ uri: getImageUrl(url) }}
                style={styles.imageThumb}
                resizeMode="cover"
              />
              {existingUrls.length + newLocalImages.length > 0 && index === coverIndex && (
                <View style={StyleSheet.flatten([styles.coverBadge, { backgroundColor: colors.primary }])}>
                  <Text style={styles.coverBadgeText}>Cover</Text>
                </View>
              )}
              <Pressable
                style={StyleSheet.flatten([styles.removeBtn, { backgroundColor: colors.destructive }])}
                onPress={() => removeExisting(index)}
                hitSlop={8}
              >
                <Feather name="x" size={12} color="#fff" />
              </Pressable>
            </View>
          ))}

          {/* Newly picked local images (not yet uploaded) */}
          {newLocalImages.map((uri, index) => {
            const globalIndex = existingUrls.length + index;
            return (
              <View key={`new-${index}`} style={styles.imageSlot}>
                <Image source={{ uri }} style={styles.imageThumb} resizeMode="cover" />
                {existingUrls.length === 0 && index === 0 && (
                  <View style={StyleSheet.flatten([styles.coverBadge, { backgroundColor: colors.primary }])}>
                    <Text style={styles.coverBadgeText}>Cover</Text>
                  </View>
                )}
                <View style={StyleSheet.flatten([styles.newBadge, { backgroundColor: colors.accent }])}>
                  <Text style={styles.newBadgeText}>New</Text>
                </View>
                <Pressable
                  style={StyleSheet.flatten([styles.removeBtn, { backgroundColor: colors.destructive }])}
                  onPress={() => removeNew(index)}
                  hitSlop={8}
                >
                  <Feather name="x" size={12} color="#fff" />
                </Pressable>
              </View>
            );
          })}

          {/* Add more button */}
          {totalImages < MAX_IMAGES && (
            <Pressable
              style={StyleSheet.flatten([styles.addBtn, { borderColor: colors.border, backgroundColor: colors.muted }])}
              onPress={pickImages}
              disabled={uploading}
            >
              {uploading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  <Feather name="camera" size={24} color={colors.mutedForeground} />
                  <Text style={[styles.addBtnLabel, { color: colors.mutedForeground }]}>
                    {totalImages === 0 ? 'Add Photos' : 'Add More'}
                  </Text>
                </>
              )}
            </Pressable>
          )}
        </ScrollView>

        {/* ── Form fields ───────────────────────────────────── */}
        <Text style={[styles.label, { color: colors.foreground, marginTop: 20 }]}>Product Name</Text>
        <Input placeholder="e.g. iPhone 13 Pro Max" value={name} onChangeText={setName} />

        <Text style={[styles.label, { color: colors.foreground, marginTop: 16 }]}>Price (₦)</Text>
        <Input
          placeholder="e.g. 500000"
          value={priceStr}
          onChangeText={setPriceStr}
          keyboardType="numeric"
        />

        <Text style={[styles.label, { color: colors.foreground, marginTop: 16 }]}>Category</Text>
        <Input placeholder="e.g. Smartphones" value={category} onChangeText={setCategory} />

        <Text style={[styles.label, { color: colors.foreground, marginTop: 16 }]}>Description</Text>
        <Input
          placeholder="Describe the product..."
          value={description}
          onChangeText={setDescription}
          multiline
          style={styles.textArea}
        />

        <View style={StyleSheet.flatten([styles.stockRow, { borderColor: colors.border }])}>
          <View>
            <Text style={[styles.stockLabel, { color: colors.foreground }]}>In Stock</Text>
            <Text style={[styles.stockHint, { color: colors.mutedForeground }]}>
              {inStock ? 'Available for purchase' : 'Marked as sold out'}
            </Text>
          </View>
          <Switch
            value={inStock}
            onValueChange={setInStock}
            trackColor={{ false: colors.muted, true: colors.primary }}
            thumbColor="#fff"
          />
        </View>

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
  container: { flex: 1 },
  content: { padding: 16 },
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
  coverBadge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: 3,
    alignItems: 'center',
  },
  coverBadgeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    color: '#fff',
  },
  newBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  newBadgeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 9,
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
  addBtn: {
    width: 90,
    height: 90,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  addBtnLabel: {
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
  stockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  stockLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    marginBottom: 2,
  },
  stockHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
  },
  buttonContainer: {
    marginTop: 28,
  },
});
