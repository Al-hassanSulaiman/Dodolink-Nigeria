"use strict";

const fs = require("fs");

const MAX_INPUT_BYTES = 16 * 1024 * 1024;

function assertDimensions(width, height, type) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new TypeError(`Invalid ${type.toUpperCase()} dimensions`);
  }
  return { width, height, type };
}

function readUInt24LE(input, offset) {
  return input[offset] | (input[offset + 1] << 8) | (input[offset + 2] << 16);
}

function parsePng(input) {
  if (
    input.length >= 24 &&
    input[0] === 0x89 &&
    input[1] === 0x50 &&
    input[2] === 0x4e &&
    input[3] === 0x47 &&
    input[12] === 0x49 &&
    input[13] === 0x48 &&
    input[14] === 0x44 &&
    input[15] === 0x52
  ) {
    return assertDimensions(input.readUInt32BE(16), input.readUInt32BE(20), "png");
  }
}

function parseJpeg(input) {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) return;

  let offset = 2;
  while (offset + 3 < input.length) {
    if (input[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    while (offset < input.length && input[offset] === 0xff) offset += 1;
    if (offset >= input.length) break;

    const marker = input[offset++];
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= input.length) break;

    const segmentLength = input.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > input.length) break;

    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame && segmentLength >= 7) {
      return assertDimensions(
        input.readUInt16BE(offset + 5),
        input.readUInt16BE(offset + 3),
        "jpg",
      );
    }

    offset += segmentLength;
  }
}

function parseGif(input) {
  if (input.length < 10) return;
  const signature = input.subarray(0, 6).toString("ascii");
  if (signature === "GIF87a" || signature === "GIF89a") {
    return assertDimensions(input.readUInt16LE(6), input.readUInt16LE(8), "gif");
  }
}

function parseBmp(input) {
  if (input.length >= 26 && input[0] === 0x42 && input[1] === 0x4d) {
    return assertDimensions(
      Math.abs(input.readInt32LE(18)),
      Math.abs(input.readInt32LE(22)),
      "bmp",
    );
  }
}

function parseWebp(input) {
  if (
    input.length < 30 ||
    input.subarray(0, 4).toString("ascii") !== "RIFF" ||
    input.subarray(8, 12).toString("ascii") !== "WEBP"
  ) {
    return;
  }

  const format = input.subarray(12, 16).toString("ascii");
  if (format === "VP8X") {
    return assertDimensions(
      readUInt24LE(input, 24) + 1,
      readUInt24LE(input, 27) + 1,
      "webp",
    );
  }
  if (format === "VP8L" && input.length >= 25 && input[20] === 0x2f) {
    const bits = input.readUInt32LE(21);
    return assertDimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1, "webp");
  }
  if (
    format === "VP8 " &&
    input.length >= 30 &&
    input[23] === 0x9d &&
    input[24] === 0x01 &&
    input[25] === 0x2a
  ) {
    return assertDimensions(
      input.readUInt16LE(26) & 0x3fff,
      input.readUInt16LE(28) & 0x3fff,
      "webp",
    );
  }
}

function parseSvg(input) {
  const text = input.subarray(0, Math.min(input.length, 64 * 1024)).toString("utf8");
  if (!/<svg(?:\s|>)/i.test(text)) return;

  const width = /\bwidth\s*=\s*["']\s*([0-9.]+)/i.exec(text);
  const height = /\bheight\s*=\s*["']\s*([0-9.]+)/i.exec(text);
  if (width && height) {
    return assertDimensions(Math.round(Number(width[1])), Math.round(Number(height[1])), "svg");
  }

  const viewBox = /\bviewBox\s*=\s*["']\s*[-0-9.]+\s+[-0-9.]+\s+([0-9.]+)\s+([0-9.]+)/i.exec(text);
  if (viewBox) {
    return assertDimensions(Math.round(Number(viewBox[1])), Math.round(Number(viewBox[2])), "svg");
  }
}

function imageSize(value) {
  if (typeof value === "string") {
    const stat = fs.statSync(value);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_INPUT_BYTES) {
      throw new TypeError("Image file is empty, invalid, or exceeds the 16 MB limit");
    }
    value = fs.readFileSync(value);
  }
  if (!(value instanceof Uint8Array)) {
    throw new TypeError("image-size expects an image buffer or local file path");
  }
  if (value.byteLength === 0 || value.byteLength > MAX_INPUT_BYTES) {
    throw new TypeError("Image buffer is empty or exceeds the 16 MB limit");
  }

  const input = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  const result =
    parsePng(input) ||
    parseJpeg(input) ||
    parseGif(input) ||
    parseBmp(input) ||
    parseWebp(input) ||
    parseSvg(input);
  if (!result) throw new TypeError("Unsupported or malformed image type");
  return result;
}

module.exports = imageSize;
module.exports.imageSize = imageSize;
module.exports.types = ["bmp", "gif", "jpg", "png", "svg", "webp"];