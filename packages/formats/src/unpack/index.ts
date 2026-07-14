/**
 * Unpack codecs — shared native (WASM) decoder backend used by the installer/archive format
 * parsers (`formats/inno`, `formats/freearc`). Built from `tools/build-unpack-streaming` →
 * `public/unpack-streaming.wasm`. See `unpack.ts` for the ABI.
 */

export {
    UNPACK_STORE,
    UNPACK_LZMA1,
    UNPACK_LZMA2,
    UNPACK_SREP,
    UNPACK_TRANSFER_BUF_SIZE,
    UnpackError,
    UnpackDecoder,
} from "./unpack";

// Generic primitives shared by the format readers (inno/freearc/iso/installshield) — the
// dependency-free core of the module, so the whole `formats/*` group is repo-extractable.
export { type RandomAccessSource, BufferSource } from "./source";
export {
    Crc32,
    Md5,
    Sha1,
    createChecksumHasher,
    verifyChecksum,
} from "./checksums";
