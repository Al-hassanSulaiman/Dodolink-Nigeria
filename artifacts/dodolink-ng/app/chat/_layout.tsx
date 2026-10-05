import { Stack } from 'expo-router';
import { RequireAccount } from '@/components/RequireAccount';
export default function ChatLayout() {
  return <RequireAccount><Stack /></RequireAccount>;
}
