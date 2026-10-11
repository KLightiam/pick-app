import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

// Where uploaded files live. Both stores have the same three methods:
//   put(key, bytes, contentType), get(key) -> { bytes, contentType } | null, remove(key)

/** Files on this machine's disk. For development only: they don't survive a redeploy. */
export function diskStorage({ dir }) {
  const fileFor = (key) => {
    const file = path.resolve(dir, key);
    if (!file.startsWith(path.resolve(dir) + path.sep)) throw new Error('bad storage key');
    return file;
  };
  return {
    async put(key, bytes, contentType) {
      const file = fileFor(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bytes);
      await writeFile(`${file}.type`, contentType);
    },
    async get(key) {
      try {
        const file = fileFor(key);
        return { bytes: await readFile(file), contentType: await readFile(`${file}.type`, 'utf8') };
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
    },
    async remove(key) {
      const file = fileFor(key);
      await rm(file, { force: true });
      await rm(`${file}.type`, { force: true });
    },
  };
}

/**
 * Any S3-compatible bucket: AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces.
 * Credentials come from the usual AWS settings (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY).
 * The bucket should be private: files are only served through the API to the driver and admins.
 */
export function s3Storage({ bucket, region, endpoint, client }) {
  const s3 = client ?? new S3Client({ region, ...(endpoint && { endpoint, forcePathStyle: true }) });
  return {
    async put(key, bytes, contentType) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType }));
    },
    async get(key) {
      try {
        const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return { bytes: Buffer.from(await out.Body.transformToByteArray()), contentType: out.ContentType };
      } catch (err) {
        if (err.name === 'NoSuchKey') return null;
        throw err;
      }
    },
    async remove(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

export function createStorage(config) {
  if (config.bucket) return s3Storage(config);
  if (config.isProduction) throw new Error('S3_BUCKET must be set in production to store driver documents');
  console.warn(`No S3_BUCKET set: driver documents are stored on disk in ${config.dir}`);
  return diskStorage({ dir: config.dir });
}
