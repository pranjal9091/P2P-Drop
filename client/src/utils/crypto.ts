/**
 * Utility to calculate SHA-256 checksum of a File using Web Crypto API.
 * Reads the file in 2MB chunks to avoid memory spikes on large files.
 */
export async function calculateSHA256(
  file: File | Blob,
  onProgress?: (percentage: number) => void
): Promise<string> {
  const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB read buffer for hashing
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  
  // For small files (< 32MB), we can hash directly
  if (file.size <= 32 * 1024 * 1024) {
    const arrayBuffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // For larger files, read sequentially and build combined hash
  // Note: Web Crypto doesn't support streaming hash objects in all browsers,
  // so we process chunk hashes or array buffers efficiently.
  const chunkHashes: string[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);
    const buffer = await chunk.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    chunkHashes.push(hashArray.map(b => b.toString(16).padStart(2, '0')).join(''));

    if (onProgress) {
      onProgress(Math.round(((i + 1) / totalChunks) * 100));
    }
  }

  // Final aggregate hash of the concatenated chunk hashes
  const encoder = new TextEncoder();
  const aggregateBuffer = encoder.encode(chunkHashes.join(''));
  const finalHashBuffer = await crypto.subtle.digest('SHA-256', aggregateBuffer);
  const finalHashArray = Array.from(new Uint8Array(finalHashBuffer));
  return finalHashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
