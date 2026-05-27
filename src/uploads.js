const crypto = require("crypto");
const path = require("path");

function imagePreviewContentType(fileName) {
  const extension = path.extname(String(fileName || "")).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return null;
}

function mediaPreviewContentType(fileName) {
  const extension = path.extname(String(fileName || "")).toLowerCase();
  if (extension === ".mp4") return "video/mp4";
  if (extension === ".webm") return "video/webm";
  if (extension === ".ogg") return "video/ogg";
  if (extension === ".mov") return "video/quicktime";
  if (extension === ".avi") return "video/x-msvideo";
  if (extension === ".mkv") return "video/x-matroska";
  if (extension === ".mp3") return "audio/mpeg";
  if (extension === ".wav") return "audio/wav";
  if (extension === ".flac") return "audio/flac";
  if (extension === ".aac") return "audio/aac";
  if (extension === ".opus") return "audio/opus";
  return null;
}

function detectPreviewType(fileName) {
  return imagePreviewContentType(fileName) || mediaPreviewContentType(fileName);
}

function normalizeUploadId(value) {
  const id = String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
  return id || null;
}

function safeUploadId(value) {
  return normalizeUploadId(value) || crypto.randomUUID();
}

module.exports = {
  imagePreviewContentType,
  mediaPreviewContentType,
  detectPreviewType,
  normalizeUploadId,
  safeUploadId
};
