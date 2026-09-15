"use client";

// Preparing photos for upload from any device. Phones and cameras produce
// huge files (and iPhones often HEIC, which most browsers can't show), so
// each photo is converted to a JPEG no larger than MAX_EDGE pixels on its
// long side before it's stored.

const MAX_EDGE = 2400;
const JPEG_QUALITY = 0.85;

const pad = (n) => String(n).padStart(2, "0");
export const dateKeyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Every photo format the upload takes, from phones and computers alike.
// Listed by extension too, because some devices (Windows, older Android)
// hand over HEIC or TIFF files without a type.
export const PHOTO_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif", ".avif", ".bmp", ".tif", ".tiff"];
export const PHOTO_ACCEPT = ["image/*", ...PHOTO_EXTENSIONS].join(",");
export const PHOTO_TYPES_LABEL = "JPEG, PNG, HEIC (iPhone), WebP, GIF, AVIF, BMP, or TIFF";

const extensionOf = (file) => ((file.name || "").match(/\.[^.]+$/) || [""])[0].toLowerCase();

export const isHeic = (file) =>
  /image\/hei[cf]/i.test(file.type) || [".heic", ".heif"].includes(extensionOf(file));

export const isTiff = (file) =>
  /image\/tiff?/i.test(file.type) || [".tif", ".tiff"].includes(extensionOf(file));

// A format we can turn into a JPEG (camera RAW files and the like can't be).
export const isImageFile = (file) =>
  PHOTO_EXTENSIONS.includes(extensionOf(file)) ||
  /^image\/(jpeg|pjpeg|png|gif|webp|heic|heif|avif|bmp|x-ms-bmp|tiff?)$/i.test(file.type || "");

async function heicToJpegBlob(file) {
  const heic2any = (await import("heic2any")).default;
  const out = await heic2any({ blob: file, toType: "image/jpeg", quality: JPEG_QUALITY });
  return Array.isArray(out) ? out[0] : out;
}

// Browsers other than Safari can't draw TIFFs, so decode the first page
// ourselves into a PNG they can.
async function tiffToPngBlob(file) {
  const UTIF = (await import("utif")).default;
  const buffer = await file.arrayBuffer();
  const ifds = UTIF.decode(buffer);
  if (!ifds.length) throw new Error("This TIFF has no image in it");
  UTIF.decodeImage(buffer, ifds[0]);
  const rgba = UTIF.toRGBA8(ifds[0]);
  const canvas = document.createElement("canvas");
  canvas.width = ifds[0].width;
  canvas.height = ifds[0].height;
  canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), ifds[0].width, ifds[0].height), 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error("This TIFF couldn't be converted"))), "image/png")
  );
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

  let loaded;
  try {
    loaded = await loadImage(source);
  } catch (err) {
    if (!isTiff(file)) throw err;
    loaded = await loadImage(await tiffToPngBlob(file));
  }
  const { img, url } = loaded;
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
