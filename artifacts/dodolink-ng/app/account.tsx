import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import { useDeleteMyAccount } from '@workspace/api-client-react';
import { RequireAccount } from '@/components/RequireAccount';
import { useColors } from '@/hooks/useColors';
import { Button, Input } from '@/components/ui';

export default function AccountScreen() {
  const colors = useColors();
  const { signOut } = useAuth();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [result, setResult] = useState<'deleted' | 'pending' | null>(null);
  const [error, setError] = useState('');
  const deletion = useDeleteMyAccount();
  const finish = async () => {
    setError('');
    let accepted = false;
    try {
      const response = await deletion.mutateAsync({ data: { confirmation: 'DELETE' } });
      accepted = true;
      setResult(response.status);
      await queryClient.cancelQueries();
      queryClient.clear();
      // Clerk's default web redirect would hide the completion message.
      // A callback clears the session without leaving this confirmation screen.
      await signOut(() => {});
    } catch (err) {
      setError(accepted ? 'Your request was accepted. Please close and reopen the app to sign out.' :
        'Could not confirm deletion. Check your connection and try again. A request already accepted by the server will still be processed.');
    }
  };
  const content = (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: 24, gap: 20 }}>
      <Stack.Screen options={{ title: 'Account settings' }} />
      <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 24 }}>
        {result ? (result === 'deleted' ? 'Account deleted' : 'Deletion requested') : 'Your account'}
      </Text>
      {result ? <>
        <Text style={{ color: colors.mutedForeground, fontSize: 16 }}>
          {result === 'deleted' ? 'Your account and associated app data have been deleted. You can still browse without signing in.' :
            'Your request has been saved and will continue even if you close the app. You will receive an email when deletion is complete. Most requests finish automatically; any remaining cleanup can take up to 90 days as described in the Privacy Policy.'}
        </Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>
          If you used Sign in with Apple, you can also revoke Apple's access in your iPhone's Apple Account settings → Sign in with Apple → DodoLink → Stop Using Apple ID. Your DodoLink deletion does not depend on this step.
        </Text>
        <Button title="Browse marketplace" onPress={() => router.replace('/(tabs)')} />
      </> : <>
        <Text style={{ color: colors.mutedForeground, fontSize: 16 }}>You can sign out or permanently delete your account here.</Text>
        <Button title="Sign out" onPress={async () => { await queryClient.cancelQueries(); queryClient.clear(); await signOut(); router.replace('/(tabs)'); }} />
        <View style={{ borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 20, gap: 16 }}>
          <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 20 }}>Delete account</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 15 }}>This permanently removes your account, owned stores, products, reviews, chats, uploaded media, and support history. Future automatic DodoLink subscription charges stop; a payment already being processed may still complete. This cannot be undone.</Text>
          {confirming ? <>
            <Text style={{ color: colors.foreground }}>Type DELETE to confirm. Deletion begins immediately after you submit.</Text>
            <Input value={confirmation} onChangeText={setConfirmation} autoCapitalize="characters" placeholder="DELETE" accessibilityLabel="Deletion confirmation" />
            <Button title={deletion.isPending ? 'Deleting account…' : 'Permanently delete my account'} disabled={confirmation !== 'DELETE' || deletion.isPending} onPress={finish} />
            <Button title="Cancel" disabled={deletion.isPending} onPress={() => { setConfirming(false); setConfirmation(''); setError(''); }} />
          </> : <Button title="Delete account" onPress={() => setConfirming(true)} />}
        </View>
      </>}
      {!!error && <Text accessibilityRole="alert" style={{ color: colors.destructive ?? colors.foreground }}>{error}</Text>}
    </ScrollView>
  );
  return result ? content : <RequireAccount>{content}</RequireAccount>;
}
