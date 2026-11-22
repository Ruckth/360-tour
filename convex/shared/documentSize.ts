// Convex v6 encodes up to five table-number bytes, 16 ID bytes and a two-byte
// footer. The longest 23-byte value encodes to 37 unpadded base32 characters.
export const MAX_CONVEX_DOCUMENT_ID_LENGTH = 37;
export const MAX_CONVEX_DOCUMENT_BYTES = 1024 * 1024;
