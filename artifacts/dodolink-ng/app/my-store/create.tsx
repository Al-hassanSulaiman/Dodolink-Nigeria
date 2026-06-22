import { useState } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { router, Stack } from 'expo-router';
import { useCreateStore } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useUserIdentity } from '@/hooks/useUserIdentity';
import { Input, Button } from '@/components/ui';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function CreateStoreScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { userId, userName } = useUserIdentity();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState('');
  const [phone, setPhone] = useState('');

  const createStore = useCreateStore({
    mutation: {
      onSuccess: () => {
        router.replace('/my-store/index');
      }
    }
  });

  const handleSubmit = () => {
    if (!userId || !userName || !name || !category || !location || !phone) return;
    createStore.mutate({ data: {
      ownerName: userName,
      ownerUserId: userId,
      name,
      description,
      category,
      location,
      phone
    }});
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: "Create Store" }} />
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]}
        bottomOffset={20}
      >
        <Text style={[styles.label, { color: colors.foreground }]}>Store Name</Text>
        <Input placeholder="e.g. Ebuka Electronics" value={name} onChangeText={setName} />

        <Text style={[styles.label, { color: colors.foreground, marginTop: 16 }]}>Category</Text>
        <Input placeholder="e.g. Electronics" value={category} onChangeText={setCategory} />

        <Text style={[styles.label, { color: colors.foreground, marginTop: 16 }]}>Location</Text>
        <Input placeholder="e.g. Alaba International Market, Lagos" value={location} onChangeText={setLocation} />

        <Text style={[styles.label, { color: colors.foreground, marginTop: 16 }]}>Phone Number</Text>
        <Input placeholder="e.g. 08012345678" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />

        <Text style={[styles.label, { color: colors.foreground, marginTop: 16 }]}>Description</Text>
        <Input 
          placeholder="Tell customers what you sell..." 
          value={description} 
          onChangeText={setDescription} 
          multiline
          style={styles.textArea}
        />

        <View style={styles.buttonContainer}>
          <Button 
            title={createStore.isPending ? "Creating..." : "Create Store"} 
            onPress={handleSubmit}
            disabled={!name || !category || !location || !phone || createStore.isPending}
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
