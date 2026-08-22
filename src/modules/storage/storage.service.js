'use strict';

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const config = require('../../config');
const { writeLog, LOG_TYPES } = require('../../config/logger');

let s3Client = null;
function getClient() {
  if (s3Client) return s3Client;
  s3Client = new S3Client({
    region: config.storage.region,
    endpoint: config.storage.endpoint,
    forcePathStyle: config.storage.forcePathStyle,
    credentials: {
      accessKeyId: config.storage.accessKeyId,
      secretAccessKey: config.storage.secretAccessKey,
    },
  });
  return s3Client;
}

function ensureLocalDir() {
  const dir = path.isAbsolute(config.storage.localDir)
    ? config.storage.localDir
    : path.join(process.cwd(), config.storage.localDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const ALLOWED_EXT = /\.(mp4|avi|mov|wmv|flv|webm|mkv)$/i;

function validateFilename(name) {
  if (!name || typeof name !== 'string') return false;
  return ALLOWED_EXT.test(name);
}

/**
 * Vytvoří jednorázovou presigned URL pro nahrávání videa.
 * S3 není nakonfigurováno → vyhodí Error (controller vrátí 503).
 */
async function createUploadUrl({ ownerId, originalFilename, contentType }) {
  if (!config.storage.s3Enabled) {
    const err = new Error('S3 storage není nakonfigurováno (chybí credentials).');
    err.code = 'STORAGE_UNAVAILABLE';
    err.status = 503;
    throw err;
  }
  if (!validateFilename(originalFilename)) {
    const err = new Error('Nepodporovaný formát videa.');
    err.code = 'INVALID_FILETYPE';
    err.status = 400;
    throw err;
  }

  const ext = path.extname(originalFilename).toLowerCase();
  const key = `videos/${ownerId}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;

  const cmd = new PutObjectCommand({
    Bucket: config.storage.bucket,
    Key: key,
    ContentType: contentType || 'application/octet-stream',
  });
  const uploadUrl = await getSignedUrl(getClient(), cmd, { expiresIn: 60 * 15 }); // 15 min
  writeLog(LOG_TYPES.UPLOAD, `Presigned URL vygenerována`, { key });
  return { key, uploadUrl, expiresIn: 900 };
}

/**
 * Ověří, že objekt existuje v S3 (klient potvrdil upload).
 * Vrátí metadata nebo null.
 */
async function headObject(key) {
  if (!config.storage.s3Enabled) return null;
  try {
    const res = await getClient().send(
      new HeadObjectCommand({ Bucket: config.storage.bucket, Key: key })
    );
    return { size: res.ContentLength, contentType: res.ContentType };
  } catch (err) {
    writeLog(LOG_TYPES.ERROR, `S3 head selhal: ${err.message}`, { key });
    return null;
  }
}

/**
 * Smaže objekt z S3 (best-effort, chyby pouze zaloguje).
 */
async function deleteObject(key) {
  if (!config.storage.s3Enabled || !key) return;
  try {
    await getClient().send(
      new DeleteObjectCommand({ Bucket: config.storage.bucket, Key: key })
    );
    writeLog(LOG_TYPES.UPLOAD, `S3 objekt smazán`, { key });
  } catch (err) {
    writeLog(LOG_TYPES.ERROR, `S3 delete selhal: ${err.message}`, { key });
  }
}

/**
 * Vrátí URL pro přehrání videa.
 * - Pokud má video s3_key, vrátí buď S3 publicBaseUrl, nebo
 *   presigned GET URL (krátká platnost).
 * - Pokud jde o starší lokální video, vrátí cestu k /uploads/<filename>.
 */
async function getPlaybackUrl(video) {
  if (video.s3_key) {
    if (config.storage.publicBaseUrl) {
      return `${config.storage.publicBaseUrl.replace(/\/$/, '')}/${video.s3_key}`;
    }
    if (!config.storage.s3Enabled) {
      // Nemáme credentials, nemůžeme podepsat.
      return null;
    }
    const cmd = new GetObjectCommand({ Bucket: config.storage.bucket, Key: video.s3_key });
    return getSignedUrl(getClient(), cmd, { expiresIn: 60 * 60 });
  }
  // Fallback na lokální soubor.
  return `/uploads/${video.filename}`;
}

module.exports = {
  getClient,
  ensureLocalDir,
  createUploadUrl,
  headObject,
  deleteObject,
  getPlaybackUrl,
  isS3Enabled: () => config.storage.s3Enabled,
};
