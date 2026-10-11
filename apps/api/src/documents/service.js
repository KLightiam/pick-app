import { randomUUID } from 'node:crypto';
import { DOCUMENT_TYPES, MAX_DOCUMENT_BYTES, documentChecklist, getMarket } from '@pick/shared';

export class DocumentError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'application/pdf': 'pdf' };

// Checks the file really is what its Content-Type says, from its first bytes.
const looksLike = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/heic': (b) => b.subarray(4, 8).toString('latin1') === 'ftyp',
  'application/pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
};

/** Driver documents: uploads, the checklist each country asks for, and admin review. */
export function createDocuments({ repo, storage }) {
  const checklistFor = async (driverId, country) => {
    const docs = await repo.listForDriver(driverId);
    return documentChecklist(getMarket(country).driverDocuments, docs).map(publicItem);
  };

  return {
    checklistFor,

    async upload(driver, { kind, contentType, bytes }) {
      if (!getMarket(driver.country).driverDocuments.includes(kind)) {
        throw new DocumentError(404, 'Pick doesn\'t ask for that document in your country');
      }
      const type = String(contentType ?? '').split(';')[0].trim().toLowerCase();
      if (!DOCUMENT_TYPES.includes(type)) throw new DocumentError(415, 'Upload a photo (JPEG, PNG, HEIC) or a PDF');
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new DocumentError(400, 'The file is empty');
      if (bytes.length > MAX_DOCUMENT_BYTES) throw new DocumentError(413, 'The file is too big. The limit is 8 MB');
      if (!looksLike[type](bytes)) throw new DocumentError(415, 'That file doesn\'t look like a photo or PDF');

      const storageKey = `drivers/${driver.id}/${kind}/${randomUUID()}.${EXTENSIONS[type]}`;
      await storage.put(storageKey, bytes, type);
      return publicDoc(await repo.create({
        driverId: driver.id, kind, storageKey, contentType: type, sizeBytes: bytes.length,
      }));
    },

    /** The file, for its driver or an admin. */
    async file(user, documentId) {
      const doc = await repo.findById(documentId);
      if (!doc || (user.role !== 'admin' && doc.driverId !== user.id)) throw new DocumentError(404, 'Document not found');
      const file = await storage.get(doc.storageKey);
      if (!file) throw new DocumentError(404, 'Document not found');
      return { bytes: file.bytes, contentType: doc.contentType };
    },

    async review(admin, documentId, { status, reason }) {
      const doc = await repo.findById(documentId);
      if (!doc) throw new DocumentError(404, 'Document not found');
      const reviewed = await repo.review(documentId, { status, by: admin.id, reason });
      if (!reviewed) throw new DocumentError(409, 'This document has already been reviewed');
      return publicDoc(reviewed);
    },

    /** Every upload by a driver, for the admin dashboard. */
    async history(driverId) {
      return (await repo.listForDriver(driverId)).map(publicDoc);
    },
  };
}

// Storage keys stay inside the API.
function publicDoc(d) {
  const { storageKey, ...rest } = d;
  return rest;
}
function publicItem(item) {
  return { ...item, document: item.document && publicDoc(item.document) };
}
