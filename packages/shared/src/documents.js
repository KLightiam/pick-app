// Documents a driver uploads before approval. Which ones each country asks for is in markets.js.

export const DOCUMENT_LABELS = Object.freeze({
  licence: "Driver's licence",
  passenger_permit: 'Passenger transport permit (P-Schein)',
  insurance: 'Car insurance',
  roadworthy: 'Roadworthy certificate (DVLA)',
  car_photo: 'Photo of your car with the number plate',
});

export const DOCUMENT_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/heic', 'application/pdf']);
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

/**
 * Where a driver stands on documents: each required kind with its latest upload, if any.
 * documents: [{ kind, status, uploadedAt, ... }], newest first or in any order.
 */
export function documentChecklist(required, documents) {
  return required.map((kind) => {
    const latest = documents
      .filter((d) => d.kind === kind)
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0] ?? null;
    return { kind, label: DOCUMENT_LABELS[kind], document: latest };
  });
}

/** True when every required document's latest upload has been approved. */
export function documentsComplete(checklist) {
  return checklist.every((item) => item.document?.status === 'approved');
}
