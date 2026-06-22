import { useState } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { useCreateProduct } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { Input, Button } from '@/components/ui';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function AddProductScreen() {
  const { storeId } = useLocalSearchParams<{ storeId: string }>();
  const id = parseInt(storeId, 10);
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priceStr, setPriceStr] = useState('');
  const [category, setCategory] = useState('');
  const [imageUrl, setImageUrl] = useState('');

  const createProduct = useCreateProduct({
    mutation: {
      onSuccess: () => {
        router.back();
      }
    }
  });

  const handleSubmit = () => {
    if (!name || !priceStr || !category) return;
    createProduct.mutate({ storeId: id, data: {
      name,
      description,
      price: parseFloat(priceStr),
      category,
      imageUrl: imageUrl || null,
      inStock: true
    }});
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: "Add Product" }} />
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]}
        bottomOffset={20}
      >
        <Text style={[styles.label, { color: colors.foreground }]}>Product Name</Text>
        <Input placeholder="e.g. iPhone 13 Pro Max" value={name} onChangeText={setName} />

        <Text style={[styles.label, { color: colors.foreground, marginTop: 16 }]}>Price (₦)</Text>
        <Input placeholder="e.g. 500000" value={priceStr} onChangeText={setPriceStr} keyboardType="numeric" />

        <Text style={[styles.label, { color: colors.foreground, marginTop: 16 }]}>Category</Text>
        <Input placeholder="e.g. Smartphones" value={category} onChangeText={setCategory} />

        <Text style={[styles.label, { color: colors.foreground, marginTop: 16 }]}>Image URL (optional)</Text>
        <Input placeholder="https://..." value={imageUrl} onChangeText={setImageUrl} autoCapitalize="none" />

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
            title={createProduct.isPending ? "Adding..." : "Add Product"} 
            onPress={handleSubmit}
            disabled={!name || !priceStr || !category || createProduct.isPending}
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
