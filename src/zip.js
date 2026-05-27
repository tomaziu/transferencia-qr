const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { once } = require("events");

function decodeFileName(value) {
  const encodedName = String(value || "arquivo").trim();

  try {
    return decodeURIComponent(encodedName);
  } catch {
    return encodedName;
  }
}

function sanitizeFileName(value) {
  const rawName = decodeFileName(value);
  const baseName = path.basename(rawName).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
  const cleaned = baseName.replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 180) || "arquivo";
}

function sanitizeRelativeFilePath(value) {
  const rawName = decodeFileName(value).replace(/\\/g, "/");
  const segments = rawName
    .split("/")
    .map((segment) => segment.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/\s+/g, " ").trim())
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .map((segment) => segment.slice(0, 180));

  if (!segments.length) return "arquivo";

  return segments.join("/");
}

function contentDisposition(fileName) {
  const safeName = sanitizeFileName(fileName);
  const fallback = safeName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "'");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
});

function updateCrc32(crc, chunk) {
  let value = crc;
  for (const byte of chunk) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return value >>> 0;
}

async function fileCrc32(filePath) {
  let crc = 0xffffffff;
  for await (const chunk of fs.createReadStream(filePath)) {
    crc = updateCrc32(crc, chunk);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function zipEntryName(fileName) {
  return sanitizeRelativeFilePath(fileName).replace(/^\/+/, "");
}

function writeUInt64LE(buffer, value, offset) {
  buffer.writeBigUInt64LE(BigInt(value), offset);
}

function zip64Extra(...values) {
  const buffer = Buffer.alloc(4 + values.length * 8);
  buffer.writeUInt16LE(0x0001, 0);
  buffer.writeUInt16LE(values.length * 8, 2);
  values.forEach((value, index) => writeUInt64LE(buffer, value, 4 + index * 8));
  return buffer;
}

function zipLocalHeader(entry) {
  const name = Buffer.from(entry.name, "utf8");
  const useZip64 = entry.useZip64;
  const extra = useZip64 ? zip64Extra(entry.size, entry.size) : Buffer.alloc(0);
  const header = Buffer.alloc(30);
  const { time, date } = dosDateTime(entry.modifiedAt);

  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(useZip64 ? 45 : 20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(time, 10);
  header.writeUInt16LE(date, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(useZip64 ? 0xffffffff : Number(entry.size), 18);
  header.writeUInt32LE(useZip64 ? 0xffffffff : Number(entry.size), 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(extra.length, 28);

  return Buffer.concat([header, name, extra]);
}

function zipCentralHeader(entry) {
  const name = Buffer.from(entry.name, "utf8");
  const useZip64 = entry.useZip64;
  const extra = useZip64 ? zip64Extra(entry.size, entry.size, entry.offset) : Buffer.alloc(0);
  const header = Buffer.alloc(46);
  const { time, date } = dosDateTime(entry.modifiedAt);

  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(45, 4);
  header.writeUInt16LE(useZip64 ? 45 : 20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(time, 12);
  header.writeUInt16LE(date, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(useZip64 ? 0xffffffff : Number(entry.size), 20);
  header.writeUInt32LE(useZip64 ? 0xffffffff : Number(entry.size), 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(extra.length, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(useZip64 ? 0xffffffff : Number(entry.offset), 42);

  return Buffer.concat([header, name, extra]);
}

function zipEndRecords(entryCount, centralStart, centralSize, needsZip64) {
  const parts = [];

  if (needsZip64) {
    const zip64End = Buffer.alloc(56);
    zip64End.writeUInt32LE(0x06064b50, 0);
    writeUInt64LE(zip64End, 44n, 4);
    zip64End.writeUInt16LE(45, 12);
    zip64End.writeUInt16LE(45, 14);
    zip64End.writeUInt32LE(0, 16);
    zip64End.writeUInt32LE(0, 20);
    writeUInt64LE(zip64End, BigInt(entryCount), 24);
    writeUInt64LE(zip64End, BigInt(entryCount), 32);
    writeUInt64LE(zip64End, centralSize, 40);
    writeUInt64LE(zip64End, centralStart, 48);
    parts.push(zip64End);

    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeUInt32LE(0, 4);
    writeUInt64LE(locator, centralStart + centralSize, 8);
    locator.writeUInt32LE(1, 16);
    parts.push(locator);
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Math.min(entryCount, 0xffff), 8);
  end.writeUInt16LE(Math.min(entryCount, 0xffff), 10);
  end.writeUInt32LE(centralSize >= 0xffffffffn ? 0xffffffff : Number(centralSize), 12);
  end.writeUInt32LE(centralStart >= 0xffffffffn ? 0xffffffff : Number(centralStart), 16);
  end.writeUInt16LE(0, 20);
  parts.push(end);

  return Buffer.concat(parts);
}

async function writeResponse(res, chunk) {
  if (!res.write(chunk)) {
    await once(res, "drain");
  }
}

async function streamFileToResponse(res, filePath) {
  for await (const chunk of fs.createReadStream(filePath)) {
    await writeResponse(res, chunk);
  }
}

async function prepareZipEntries(files) {
  const usedNames = new Map();
  const entries = [];

  for (const file of files) {
    const stat = await fsp.stat(file.targetPath);
    if (!stat.isFile()) throw new Error("Arquivo indisponivel");

    const baseName = zipEntryName(file.fileName);
    const parsed = path.posix.parse(baseName);
    const count = usedNames.get(baseName) || 0;
    usedNames.set(baseName, count + 1);
    const name = count === 0 ? baseName : `${parsed.dir ? `${parsed.dir}/` : ""}${parsed.name} (${count})${parsed.ext}`;

    entries.push({
      name,
      filePath: file.targetPath,
      size: BigInt(stat.size),
      crc: await fileCrc32(file.targetPath),
      modifiedAt: stat.mtime
    });
  }

  return entries;
}

async function sendZip(res, zipName, files) {
  const entries = await prepareZipEntries(files);
  let offset = 0n;
  let needsZip64 = false;

  res.writeHead(200, {
    "content-type": "application/zip",
    "content-disposition": contentDisposition(zipName),
    "cache-control": "no-store"
  });

  for (const entry of entries) {
    entry.offset = offset;
    entry.useZip64 = entry.size >= 0xffffffffn || offset >= 0xffffffffn;
    needsZip64 = needsZip64 || entry.useZip64;

    const header = zipLocalHeader(entry);
    await writeResponse(res, header);
    offset += BigInt(header.length);

    await streamFileToResponse(res, entry.filePath);
    offset += entry.size;
  }

  const centralStart = offset;
  for (const entry of entries) {
    const header = zipCentralHeader(entry);
    await writeResponse(res, header);
    offset += BigInt(header.length);
  }

  const centralSize = offset - centralStart;
  needsZip64 = needsZip64 || entries.length >= 0xffff || centralStart >= 0xffffffffn || centralSize >= 0xffffffffn;
  const end = zipEndRecords(entries.length, centralStart, centralSize, needsZip64);
  await writeResponse(res, end);
  res.end();
}

module.exports = {
  sendZip
};
