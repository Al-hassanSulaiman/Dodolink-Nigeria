import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const USER_ID_KEY = '@dodolink_userId';
const USER_NAME_KEY = '@dodolink_userName';

export function useUserIdentity() {
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>('Guest');
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    async function loadIdentity() {
      try {
        let storedId = await AsyncStorage.getItem(USER_ID_KEY);
        let storedName = await AsyncStorage.getItem(USER_NAME_KEY);

        if (!storedId) {
          storedId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
          await AsyncStorage.setItem(USER_ID_KEY, storedId);
        }
        if (!storedName) {
          storedName = 'Customer ' + Math.floor(Math.random() * 1000);
          await AsyncStorage.setItem(USER_NAME_KEY, storedName);
        }

        setUserId(storedId);
        setUserName(storedName);
      } catch (e) {
        console.error('Failed to load identity', e);
      } finally {
        setIsReady(true);
      }
    }
    loadIdentity();
  }, []);

  const updateUserName = async (name: string) => {
    setUserName(name);
    await AsyncStorage.setItem(USER_NAME_KEY, name);
  };

  return { userId, userName, updateUserName, isReady };
}
