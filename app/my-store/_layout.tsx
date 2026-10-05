import { Stack } from 'expo-router';
import { RequireAccount } from '@/components/RequireAccount';
export default function MyStoreLayout() {
  return <RequireAccount><Stack /></RequireAccount>;
}
