"use client";

// Preparing photos for upload from any device. Phones and cameras produce
// huge files (and iPhones often HEIC, which most browsers can't show), so
// each photo is converted to a JPEG no larger than MAX_EDGE pixels on its
// long side before it's stored.

const MAX_EDGE = 2400;
const JPEG_QUALITY = 0.85;

const pad = (n) => String(n).padStart(2, "0");
export const dateKeyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const isHeic = (file) =>
  /image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name || "");

export const isImageFile = (file) => (file.type || "").startsWith("image/") || isHeic(file);

async function heicToJpegBlob(file) {
  const heic2any = (await import("heic2any")).default;
  const out = await heic2any({ blob: file, toType: "image/jpeg", quality: JPEG_QUALITY });
  return Array.isArray(out) ? out[0] : out;
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This photo couldn't be read"));
    };
    img.src = url;
  });
}

// Returns { blob, width, height, previewUrl } ready to upload as a JPEG.
export async function preparePhoto(file) {
  let source = file;
  if (isHeic(file)) {
    try {
      source = await heicToJpegBlob(file);
    } catch {
      // Safari can decode HEIC itself; let the canvas step try.
    }
  }

  const { img, url } = await loadImage(source);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.round(img.naturalWidth * scale);
  const height = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(img, 0, 0, width, height);
  URL.revokeObjectURL(url);

  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error("This photo couldn't be converted"))), "image/jpeg", JPEG_QUALITY)
  );
  return { blob, width, height, previewUrl: URL.createObjectURL(blob) };
}
