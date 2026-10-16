import { Platform } from 'react-native';
import { chatMediaInfo } from './chatMediaInfo';

export async function saveChatMedia(url: string, messageId: number, contentType: string): Promise<'saved' | 'started'> {
  if (Platform.OS === 'web') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error('Could not download the attachment. Please try again.');
      const blob = await response.blob();
      if (!blob.size) throw new Error('The attachment was empty. Please try again.');
      const { extension } = chatMediaInfo(url, blob.type || contentType);
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `dodolink-chat-${messageId}.${extension}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
      return 'started';
    } finally {
      clearTimeout(timer);
    }
  }

  const [fs, library] = await Promise.all([
    import('expo-file-system/legacy'), import('expo-media-library'),
  ]);
  // Android 13+ can add media without reading the user's existing library.
  if (Platform.OS === 'ios' || Number(Platform.Version) < 33) {
    const permission = await library.requestPermissionsAsync(true, ['photo', 'video']);
    if (!permission.granted) {
      throw new Error('Saving was not allowed. Enable photo/video saving for Dodolink in Settings, then try again.');
    }
  }
  if (!fs.cacheDirectory) throw new Error('Phone storage is unavailable. Please try again.');
  const base = `${fs.cacheDirectory}dodolink-chat-${messageId}-${Date.now()}`;
  const task = fs.createDownloadResumable(url, `${base}.download`);
  let timedOut = false;
  let savedPath: string | undefined;
  const timer = setTimeout(() => {
    timedOut = true;
    void task.cancelAsync().catch(() => {});
  }, 120000);
  try {
    const result = await task.downloadAsync();
    if (timedOut) throw new Error('Download took too long. Check your connection and try again.');
    if (!result || result.status < 200 || result.status >= 300) {
      throw new Error('Could not download the attachment. Please try again.');
    }
    const type = Object.entries(result.headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1];
    savedPath = `${base}.${chatMediaInfo(url, type || contentType).extension}`;
    await fs.moveAsync({ from: result.uri, to: savedPath });
    await library.saveToLibraryAsync(savedPath);
    return 'saved';
  } finally {
    clearTimeout(timer);
    await fs.deleteAsync(`${base}.download`, { idempotent: true }).catch(() => {});
    if (savedPath) await fs.deleteAsync(savedPath, { idempotent: true }).catch(() => {});
  }
}
