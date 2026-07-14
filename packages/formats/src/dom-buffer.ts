/**
 * DOM buffer-view casts.
 *
 * TypeScript 5.7+ made `Uint8Array` generic over its backing buffer
 * (`Uint8Array<ArrayBufferLike>`) and tightened the DOM lib types so that
 * `BufferSource` / `BlobPart` / `FileSystemWriteChunkType` / `bufferData` /
 * `createImageData` accept only `ArrayBuffer`-backed views, explicitly
 * excluding `SharedArrayBuffer`.
 *
 * Our entire guest address space is SharedArrayBuffer-backed, so every view we
 * hand to a browser sink is now `Uint8Array<ArrayBufferLike>` and rejected at
 * the type level. At RUNTIME browsers accept SAB-backed views into all of these
 * sinks — the tightening is purely type-level. Copying SAB -> ArrayBuffer here
 * would defeat the zero-alloc hot paths, so we cast at the boundary instead.
 *
 * Keep these casts localized to the DOM boundary; do not widen them into
 * general `any` usage.
 */

export const asBufferSource = (v: ArrayBufferView): BufferSource =>
  v as unknown as BufferSource;

export const asBlobPart = (v: ArrayBufferView): BlobPart =>
  v as unknown as BlobPart;

export const asWriteChunk = (v: ArrayBufferView): FileSystemWriteChunkType =>
  v as unknown as FileSystemWriteChunkType;
