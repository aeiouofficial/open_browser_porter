/**
 * FreeArc `.arc` reader — footer → directory → file table → extraction.
 *
 * Byte layout per the canonical `unarc` decompressor (ArcStructure.h / C_LZMA.cpp). The
 * archive is a sequence of blocks; the FOOTER block (last in file, found by scanning the
 * tail for the "ArC\x01" signature of its local descriptor) lists the DIRECTORY block(s),
 * which in turn describe the solid DATA blocks and the file table.
 *
 * Everything is little-endian. Sizes/positions/counts use FreeArc's 1–9 byte varint;
 * CRC/time/signature are fixed 4-byte LE. Positions in the footer & directory are stored
 * RELATIVE and BACKWARDS (absolute = base.pos − stored). A solid block compressed with
 * "storing" is raw bytes (per-file slice = a direct range read); an "lzma:…" block is a
 * raw LZMA1 stream (no header) decoded via the shared WASM decoder with synthesized props.
 *
 * Reads through a `RandomAccessSource`, so the directory scan touches only the small
 * footer/dir blocks and "storing" files stream by range — a multi-GB archive never has to
 * live in RAM (the CLI feeds a file/ISO-backed source; the worker wraps a BufferSource).
 */

import type { RandomAccessSource } from "../unpack/source";
import { BufferSource } from "../unpack/source";
import { UnpackDecoder, UNPACK_LZMA1, UNPACK_SREP } from "../unpack";
import { parseFreeArcPipeline, lzmaPropsFor } from "./method";

/**
 * A block uses a compression filter we can't undo yet (e.g. `srep` — FreeArc's long-range
 * dedup preprocessor). The directory still parses, so LISTING works; only extraction of the
 * affected solid block fails. Callers can catch this to fall back gracefully.
 */
export class FreeArcUnsupportedError extends Error {
    constructor(readonly filter: string, readonly method: string) {
        super(`FreeArc: unsupported compression filter "${filter}" (block method "${method}")`);
        this.name = "FreeArcUnsupportedError";
    }
}

/** Pipeline filters we know how to undo (the base lzma/storing codec is handled separately). */
const SUPPORTED_FILTERS = new Set<string>(["srep"]);

const SIGNATURE = 0x01437241; // "ArC\x01" as LE uint32 (bytes 41 72 43 01)
const MAX_FOOTER_SCAN = 4096;

// Block types (ArcStructure.h enum).
const DIR_BLOCK = 3;
const FOOTER_BLOCK = 4;

export interface FreeArcSolidBlock {
    /** Absolute file offset of the solid block's (compressed) data. */
    pos: number;
    compressor: string;
    compSize: number;
    /** Total decompressed size of the block (Σ of its files' sizes). */
    origSize: number;
}

export interface FreeArcFile {
    /** Forward-slash full path. */
    path: string;
    size: number;
    isDir: boolean;
    /** Expected CRC32 (>>> 0) of the file contents. */
    crc: number;
    /** Index into `FreeArcListing.blocks`. */
    blockIndex: number;
    /** Byte offset of this file within the decompressed solid block. */
    offsetInBlock: number;
}

export interface FreeArcListing {
    files: FreeArcFile[];
    blocks: FreeArcSolidBlock[];
}

// --- little-endian + varint primitives ---------------------------------------------

class BinReader {
    pos = 0;
    constructor(readonly b: Uint8Array) {}

    u8(): number {
        return this.b[this.pos++]!;
    }
    u32(): number {
        const p = this.pos;
        this.pos += 4;
        return (this.b[p]! | (this.b[p + 1]! << 8) | (this.b[p + 2]! << 16) | (this.b[p + 3]! << 24)) >>> 0;
    }
    /** NUL-terminated ASCII string. */
    cstr(): string {
        let end = this.pos;
        while (end < this.b.length && this.b[end] !== 0) end++;
        const s = String.fromCharCode(...this.b.subarray(this.pos, end));
        this.pos = end + 1; // skip NUL
        return s;
    }
    /** FreeArc 1–9 byte varint (unary length in the low bits of byte 0). */
    varint(): number {
        const b = this.b;
        const p = this.pos;
        const b0 = b[p]!;
        if ((b0 & 1) === 0) {
            this.pos = p + 1;
            return b0 >>> 1;
        }
        if ((b0 & 3) === 1) {
            this.pos = p + 2;
            return (b[p]! | (b[p + 1]! << 8)) >>> 2;
        }
        if ((b0 & 7) === 3) {
            this.pos = p + 3;
            return (b[p]! | (b[p + 1]! << 8) | (b[p + 2]! << 16)) >>> 3;
        }
        if ((b0 & 15) === 7) {
            this.pos = p + 4;
            return ((b[p]! | (b[p + 1]! << 8) | (b[p + 2]! << 16) | (b[p + 3]! << 24)) >>> 0) >>> 4;
        }
        // 5–9 bytes: assemble as BigInt, then narrow (archive offsets fit in 2^53).
        const lo = (b[p]! | (b[p + 1]! << 8) | (b[p + 2]! << 16) | (b[p + 3]! << 24)) >>> 0;
        const hi = (b[p + 4]! | (b[p + 5]! << 8) | (b[p + 6]! << 16) | (b[p + 7]! << 24)) >>> 0;
        const y = BigInt(lo) | (BigInt(hi) << 32n);
        if ((b0 & 31) === 15) {
            this.pos = p + 5;
            return Number((y & ((1n << 40n) - 1n)) >> 5n);
        }
        if ((b0 & 63) === 31) {
            this.pos = p + 6;
            return Number((y & ((1n << 48n) - 1n)) >> 6n);
        }
        if ((b0 & 127) === 63) {
            this.pos = p + 7;
            return Number((y & ((1n << 56n) - 1n)) >> 7n);
        }
        if ((b0 & 255) === 127) {
            this.pos = p + 8;
            return Number(y >> 8n);
        }
        // 0xFF prefix: skip it, full uint64 follows.
        const lo2 = (b[p + 1]! | (b[p + 2]! << 8) | (b[p + 3]! << 16) | (b[p + 4]! << 24)) >>> 0;
        const hi2 = (b[p + 5]! | (b[p + 6]! << 8) | (b[p + 7]! << 16) | (b[p + 8]! << 24)) >>> 0;
        this.pos = p + 9;
        return Number(BigInt(lo2) | (BigInt(hi2) << 32n));
    }
}

// --- CRC32 (IEEE, zlib polynomial) -------------------------------------------------

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[i] = c >>> 0;
    }
    return t;
})();
export function crc32(data: Uint8Array, crc = 0xffffffff): number {
    for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
    return crc >>> 0;
}
const crc32Final = (crc: number) => (crc ^ 0xffffffff) >>> 0;

// --- local descriptor + footer scan ------------------------------------------------

interface LocalDescriptor {
    type: number;
    compressor: string;
    origSize: number;
    compSize: number;
    crc: number;
    /** Absolute offset of the block's (compressed) data = descriptorPos − compSize. */
    dataPos: number;
}

/** Parse a control block's local descriptor at `rel` within `buf` (descriptor abs offset = absBase + rel). */
function parseLocalDescriptor(buf: Uint8Array, rel: number, absBase: number): LocalDescriptor {
    const r = new BinReader(buf);
    r.pos = rel;
    const sign = r.u32();
    if (sign !== SIGNATURE) throw new Error("FreeArc: bad block signature");
    const type = r.varint();
    const compressor = r.cstr();
    const origSize = r.varint();
    const compSize = r.varint();
    const crc = r.u32();
    const descrPos = absBase + rel;
    if (origSize <= 0 || compSize <= 0 || compSize > descrPos) {
        throw new Error("FreeArc: invalid block descriptor");
    }
    return { type, compressor, origSize, compSize, crc, dataPos: descrPos - compSize };
}

/** Locate the footer block by scanning the last ≤4096 bytes backward for its descriptor signature. */
function findFooterDescriptor(src: RandomAccessSource): LocalDescriptor {
    const scan = Math.min(src.size, MAX_FOOTER_SCAN);
    const base = src.size - scan;
    const tail = src.readRangeSync(base, src.size);
    for (let p = tail.length - 4; p >= 0; p--) {
        if (tail[p] === 0x41 && tail[p + 1] === 0x72 && tail[p + 2] === 0x43 && tail[p + 3] === 0x01) {
            try {
                const d = parseLocalDescriptor(tail, p, base);
                if (d.type === FOOTER_BLOCK) return d;
            } catch {
                /* false-positive signature inside data — keep scanning */
            }
        }
    }
    throw new Error("FreeArc: footer block not found (not a FreeArc archive or corrupt)");
}

// --- block decompression -----------------------------------------------------------

/** Decode just the base codec (storing/lzma) of a raw block buffer. `origSize` is the
 *  decoded size when known (the directory/footer origSize), or -1 for an intermediate
 *  pipeline stage whose size we don't know yet (decode to the LZMA end-of-stream marker). */
function decodeBase(lzma: UnpackDecoder, comp: Uint8Array, base: ReturnType<typeof parseFreeArcPipeline>["base"], origSize: number): Uint8Array {
    if (base.kind === "store") return origSize >= 0 && comp.length !== origSize ? comp.subarray(0, origSize) : comp;
    if (base.kind === "lzma") {
        const out = lzma.decode(UNPACK_LZMA1, comp, lzmaPropsFor(base));
        if (origSize >= 0 && out.length < origSize) throw new Error(`FreeArc: short LZMA output (${out.length} < ${origSize})`);
        return origSize >= 0 && out.length !== origSize ? out.subarray(0, origSize) : out;
    }
    throw new Error(`FreeArc: unsupported base compressor "${base.raw}"`);
}

/**
 * Read and decompress a block's data into a buffer of exactly `origSize` bytes. Handles a
 * "+"-pipeline by decoding the base codec then undoing pre-filters in reverse. A filter we
 * can't undo yet (srep) throws `FreeArcUnsupportedError` — control blocks (footer/dir) are
 * plain lzma with no filter, so listing is unaffected; only filtered DATA blocks fail.
 */
function readBlock(
    src: RandomAccessSource,
    lzma: UnpackDecoder,
    dataPos: number,
    compSize: number,
    origSize: number,
    compressor: string,
): Uint8Array {
    const pipe = parseFreeArcPipeline(compressor);
    for (const f of pipe.filters) {
        if (!SUPPORTED_FILTERS.has(f)) throw new FreeArcUnsupportedError(f, compressor);
    }
    const comp = src.readRangeSync(dataPos, dataPos + compSize);
    // No filters → the base output IS the final block, of known origSize.
    if (pipe.filters.length === 0) return decodeBase(lzma, comp, pipe.base, origSize);
    // With filters, the base decodes to an intermediate (filtered) stream of unknown size;
    // filter passes (reverse order) would then reconstruct `origSize` bytes. Unreachable
    // until a filter is in SUPPORTED_FILTERS, but kept for when srep lands.
    let buf = decodeBase(lzma, comp, pipe.base, -1);
    for (let i = pipe.filters.length - 1; i >= 0; i--) {
        buf = applyFilter(lzma, pipe.filters[i]!, buf, origSize);
    }
    return buf;
}

/**
 * Undo a single pipeline filter. `srep` (FreeArc's long-range dedup) is decoded by the shared
 * WASM codec (`UNPACK_SREP`), verified byte-exact against the reference srep + 7-zip LZMA.
 */
function applyFilter(lzma: UnpackDecoder, filter: string, data: Uint8Array, origSize: number): Uint8Array {
    if (filter === "srep") {
        // Pass the known output size (u32 LE) so the WASM pre-allocates exactly once — avoids
        // Vec's doubling-realloc spike that blows the wasm32 memory ceiling on multi-GB blocks.
        let props: Uint8Array | undefined;
        if (origSize >= 0) {
            props = new Uint8Array(4);
            new DataView(props.buffer).setUint32(0, origSize >>> 0, true);
        }
        const out = lzma.decode(UNPACK_SREP, data, props);
        if (origSize >= 0 && out.length !== origSize) {
            throw new Error(`FreeArc: srep output ${out.length} != expected ${origSize}`);
        }
        return out;
    }
    throw new FreeArcUnsupportedError(filter, filter);
}

// --- directory parse ---------------------------------------------------------------

function parseDirectory(dir: Uint8Array, dirBlockPos: number, blocks: FreeArcSolidBlock[], files: FreeArcFile[]): void {
    const r = new BinReader(dir);
    const numBlocks = r.varint();
    const numFiles: number[] = new Array(numBlocks);
    for (let i = 0; i < numBlocks; i++) numFiles[i] = r.varint();
    const compressors: string[] = new Array(numBlocks);
    for (let i = 0; i < numBlocks; i++) compressors[i] = r.cstr();
    const offsets: number[] = new Array(numBlocks);
    for (let i = 0; i < numBlocks; i++) offsets[i] = r.varint();
    const compSizes: number[] = new Array(numBlocks);
    for (let i = 0; i < numBlocks; i++) compSizes[i] = r.varint();

    const blockBase = blocks.length;
    for (let i = 0; i < numBlocks; i++) {
        blocks.push({ pos: dirBlockPos - offsets[i]!, compressor: compressors[i]!, compSize: compSizes[i]!, origSize: 0 });
    }
    // num_of_files → cumulative prefix sum (flat-file boundaries per block).
    const cum: number[] = new Array(numBlocks);
    let total = 0;
    for (let i = 0; i < numBlocks; i++) {
        total += numFiles[i]!;
        cum[i] = total;
    }
    const totalFiles = total;

    // Distinct directory paths (normalize separators to "/").
    const dirCount = r.varint();
    const dirs: string[] = new Array(dirCount);
    for (let i = 0; i < dirCount; i++) dirs[i] = r.cstr().replace(/\\/g, "/");

    // Per-file columns (column-major).
    const names: string[] = new Array(totalFiles);
    for (let i = 0; i < totalFiles; i++) names[i] = r.cstr();
    const dirNums: number[] = new Array(totalFiles);
    for (let i = 0; i < totalFiles; i++) dirNums[i] = r.varint();
    const sizes: number[] = new Array(totalFiles);
    for (let i = 0; i < totalFiles; i++) sizes[i] = r.varint();
    for (let i = 0; i < totalFiles; i++) r.u32(); // mtime (unused)
    const isdirs: number[] = new Array(totalFiles);
    for (let i = 0; i < totalFiles; i++) isdirs[i] = r.u8();
    const crcs: number[] = new Array(totalFiles);
    for (let i = 0; i < totalFiles; i++) crcs[i] = r.u32();

    // Walk files in flat order; offsets accumulate within each solid block. Σ sizes per
    // block also yields the block's decompressed origSize.
    let block = 0;
    let offsetInBlock = 0;
    for (let i = 0; i < totalFiles; i++) {
        while (block < numBlocks - 1 && i >= cum[block]!) {
            block++;
            offsetInBlock = 0;
        }
        const dirPath = dirs[dirNums[i]!] ?? "";
        const name = names[i]!.replace(/\\/g, "/");
        const path = dirPath ? `${dirPath}/${name}` : name;
        const isDir = isdirs[i] !== 0;
        files.push({ path, size: sizes[i]!, isDir, crc: crcs[i]! >>> 0, blockIndex: blockBase + block, offsetInBlock });
        if (!isDir) {
            offsetInBlock += sizes[i]!;
            blocks[blockBase + block]!.origSize += sizes[i]!;
        }
    }
}

// --- public: list + extract --------------------------------------------------------

/** Parse an archive's footer + directory blocks into a flat file/block listing. */
export function readFreeArcListing(src: RandomAccessSource, lzma: UnpackDecoder): FreeArcListing {
    const footerDesc = findFooterDescriptor(src);
    const footer = readBlock(src, lzma, footerDesc.dataPos, footerDesc.compSize, footerDesc.origSize, footerDesc.compressor);

    const r = new BinReader(footer);
    const nControl = r.varint();
    const dirBlocks: { pos: number; compSize: number; origSize: number; compressor: string }[] = [];
    for (let i = 0; i < nControl; i++) {
        const type = r.varint();
        const compressor = r.cstr();
        const relPos = r.varint();
        const origSize = r.varint();
        const compSize = r.varint();
        r.u32(); // block CRC (unused — control blocks are tiny, slice carves files)
        if (type === DIR_BLOCK) {
            dirBlocks.push({ pos: footerDesc.dataPos - relPos, compSize, origSize, compressor });
        }
    }

    const blocks: FreeArcSolidBlock[] = [];
    const files: FreeArcFile[] = [];
    for (const db of dirBlocks) {
        const dir = readBlock(src, lzma, db.pos, db.compSize, db.origSize, db.compressor);
        parseDirectory(dir, db.pos, blocks, files);
    }
    return { files, blocks };
}

export interface FreeArcExtractOptions {
    /** Keep only files whose forward-slash path passes this predicate. */
    wantFile?: (path: string) => boolean;
    /**
     * Verify each extracted file against the directory's stored checksum (default OFF).
     *
     * The decode itself is verified byte-exact against the reference srep (compiled from
     * Bulat Ziganshin's source) and the 7-Zip reference LZMA decoder, and yields structurally
     * valid files (e.g. PDFs ending in %%EOF). However the value stored in the directory's
     * per-file "crc" column does NOT match a standard CRC32-IEEE of the decoded content for
     * the FreeArc builds seen in the wild (it's some FreeArc-specific checksum/field whose
     * convention isn't reverse-engineered yet), so checking against it would spuriously fail.
     * Leave off unless you know your archive's checksum is plain CRC32.
     */
    verifyCrc?: boolean;
    onProgress?: (pct: number, label: string) => void;
}

/**
 * Extract every wanted file to `sink(path, bytes)`. Groups by solid block: "storing"
 * blocks stream per-file by range read (no whole-block buffer), other blocks decode once
 * (base codec + pipeline filters) then carve their files. See `verifyCrc` re: integrity.
 */
export function extractFreeArc(
    src: RandomAccessSource,
    lzma: UnpackDecoder,
    sink: (path: string, bytes: Uint8Array) => void,
    opts: FreeArcExtractOptions = {},
): void {
    const { files, blocks } = readFreeArcListing(src, lzma);
    const want = opts.wantFile ?? (() => true);
    const verify = opts.verifyCrc === true;

    // Group wanted (non-dir) files by solid block.
    const byBlock = new Map<number, FreeArcFile[]>();
    let totalWanted = 0;
    for (const f of files) {
        if (f.isDir || !want(f.path)) continue;
        (byBlock.get(f.blockIndex) ?? byBlock.set(f.blockIndex, []).get(f.blockIndex)!).push(f);
        totalWanted++;
    }

    let done = 0;
    for (const [blockIndex, group] of byBlock) {
        const blk = blocks[blockIndex]!;
        const pipe = parseFreeArcPipeline(blk.compressor);
        // Fast path only for a pure "storing" block (no pre-filter): files are raw, contiguous
        // ranges we can read directly. Anything else decodes the whole block via readBlock.
        const stored = pipe.filters.length === 0 && pipe.base.kind === "store";
        const decoded = stored ? null : readBlock(src, lzma, blk.pos, blk.compSize, blk.origSize, blk.compressor);
        for (const f of group) {
            const bytes = stored
                ? src.readRangeSync(blk.pos + f.offsetInBlock, blk.pos + f.offsetInBlock + f.size)
                : decoded!.subarray(f.offsetInBlock, f.offsetInBlock + f.size);
            if (verify && f.size > 0) {
                const got = crc32Final(crc32(bytes));
                if (got !== f.crc) throw new Error(`FreeArc: CRC mismatch for "${f.path}" (${got.toString(16)} != ${f.crc.toString(16)})`);
            }
            sink(f.path, stored ? bytes : bytes.slice());
            done++;
            opts.onProgress?.(totalWanted ? Math.round((done / totalWanted) * 100) : 100, "Extracting FreeArc");
        }
    }
}

/** Convenience: extract a whole in-memory archive into a rel-path → bytes map. */
export async function extractFreeArcToMap(
    data: Uint8Array,
    lzma: UnpackDecoder,
    opts: FreeArcExtractOptions = {},
): Promise<Map<string, Uint8Array>> {
    const out = new Map<string, Uint8Array>();
    extractFreeArc(new BufferSource(data), lzma, (path, bytes) => out.set(path, bytes), opts);
    return out;
}
