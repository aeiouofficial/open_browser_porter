/**
 * FreeArc `.arc` disc/repack archive reading.
 *
 * FreeArc (`ArC\x01` magic) is the payload format of the common "Inno Setup + ISDone/unarc
 * + FreeArc" Russian repack: the Inno `setup.exe` only orchestrates, while the real game
 * lives in external `.pak`/`.arc` archives. This reader extracts those statically (no VM),
 * reusing the existing inno-lzma WASM decoder for the small LZMA-compressed control blocks.
 *
 * Environment-agnostic: feed a `RandomAccessSource` (in-memory `BufferSource`, or a
 * file/ISO-backed source in tooling) so a multi-GB archive needn't live in RAM.
 */

export { detectFreeArc, FREEARC_SIGNATURE } from "./detect";
export {
    type FreeArcFile,
    type FreeArcSolidBlock,
    type FreeArcListing,
    type FreeArcExtractOptions,
    FreeArcUnsupportedError,
    readFreeArcListing,
    extractFreeArc,
    extractFreeArcToMap,
    crc32,
} from "./reader";
export {
    type FreeArcMethod,
    type FreeArcPipeline,
    parseFreeArcMethod,
    parseFreeArcPipeline,
    parseFreeArcSize,
    lzmaPropsByte,
    lzmaPropsFor,
} from "./method";
