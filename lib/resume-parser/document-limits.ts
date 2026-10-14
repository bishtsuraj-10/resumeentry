export class DocumentLimitError extends Error {
  constructor() {
    super("Document exceeds local processing limits");
    this.name = "DocumentLimitError";
  }
}
export class DocumentTimeoutError extends Error {
  constructor() {
    super("Local document extraction timed out");
    this.name = "DocumentTimeoutError";
  }
}
export function checkDocxExpansion(bytes: Buffer) {
  let total = 0,
    entries = 0;
  // ZIP central directory stores expanded sizes without inflating document contents.
  for (let i = 0; i + 46 <= bytes.length; i++)
    if (bytes.readUInt32LE(i) === 0x02014b50) {
      total += bytes.readUInt32LE(i + 24);
      entries++;
      if (total > 50 * 1024 * 1024 || entries > 1000)
        throw new DocumentLimitError();
      i +=
        45 +
        bytes.readUInt16LE(i + 28) +
        bytes.readUInt16LE(i + 30) +
        bytes.readUInt16LE(i + 32);
    }
}
export function checkImageDimensions(bytes: Buffer) {
  let width = 0,
    height = 0;
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    for (let i = 2; i + 9 < bytes.length; ) {
      if (bytes[i] !== 255) break;
      const marker = bytes[i + 1];
      if (marker === 0xda || marker === 0xd9) break;
      const length = bytes.readUInt16BE(i + 2);
      if (length < 2) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        height = bytes.readUInt16BE(i + 5);
        width = bytes.readUInt16BE(i + 7);
        break;
      }
      i += 2 + length;
    }
  }
  if (width > 10000 || height > 10000 || width * height > 16000000)
    throw new DocumentLimitError();
}
