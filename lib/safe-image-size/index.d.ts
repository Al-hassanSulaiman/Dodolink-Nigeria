export interface ImageSize {
  width: number;
  height: number;
  type: "bmp" | "gif" | "jpg" | "png" | "svg" | "webp";
}

export function imageSize(input: Uint8Array | string): ImageSize;
export default imageSize;