const crypto = require("crypto");
const path = require("path");

function imagePreviewContentType(fileName) {
  const extension = path.extname(String(fileName || "")).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return null;
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
  normalizeUploadId,
  safeUploadId
};
