const extensions: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/heic': 'heic', 'image/heif': 'heif', 'image/avif': 'avif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'video/x-m4v': 'm4v', 'video/3gpp': '3gp', 'video/x-msvideo': 'avi',
  'video/x-matroska': 'mkv',
};

export function chatMediaInfo(url: string, contentType = '') {
  const mime = contentType.split(';')[0].trim().toLowerCase();
  const video = mime.startsWith('video/') || (!mime.startsWith('image/') &&
    /chat-vid|\.(mp4|mov|m4v|avi|mkv|webm|3gp)(?:[?#]|$)/i.test(url));
  return { video, extension: extensions[mime] ?? (video ? 'mp4' : 'jpg') };
}
