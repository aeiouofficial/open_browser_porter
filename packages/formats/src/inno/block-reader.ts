/**
 * Setup header block decompression — ported from innoextract stream/block.cpp.
 */

import { Crc32 } from "../unpack/checksums";
import { readU32At } from "./binary-reader";
import { InnoFormatError } from "./errors";
import { UNPACK_LZMA1, type UnpackDecoder } from "../unpack";
import type { RandomAccessSource } from "../unpack/source";
import type { InnoVersion } from "./version";
import { asBufferSource } from "../dom-buffer";

const SUBCHUNK_SIZE = 4096; // block.cpp:134

const BlockCompression = { Stored: 0, Zlib: 1, LZMA1: 2 } as const;

async function inflateZlib(data: Uint8Array): Promise<Uint8Array> {
    if (typeof DecompressionStream === "undefined") {
        throw new InnoFormatError(
            "DecompressionStream unavailable — zlib block decompression requires Bun/worker runtime",
        );
    }
    const ds = new DecompressionStream("deflate");
    const writer = ds.writable.getWriter();
    await writer.write(asBufferSource(data));
    await writer.close();
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.byteLength;
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
        out.set(c, off);
        off += c.byteLength;
    }
    return out;
}

function stripBlockCrcFrames(data: Uint8Array): Uint8Array {
    const chunks: Uint8Array[] = [];
    let pos = 0;
    while (pos < data.byteLength) {
        if (pos + 4 > data.byteLength) throw new InnoFormatError("unexpected block end", pos, "block-crc");
        const blockCrc = readU32At(data, pos);
        pos += 4;
        const chunkLen = Math.min(SUBCHUNK_SIZE, data.byteLength - pos);
        if (chunkLen === 0) break;
        const chunk = data.subarray(pos, pos + chunkLen);
        pos += chunkLen;
        const actual = new Crc32();
        actual.init();
        actual.update(chunk);
        if (actual.finalize() !== blockCrc) {
            throw new InnoFormatError("block CRC32 mismatch", pos - chunkLen, "block-crc");
        }
        chunks.push(chunk.slice());
    }
    const total = chunks.reduce((s, c) => s + c.byteLength, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
        out.set(c, off);
        off += c.byteLength;
    }
    return out;
}

class CrcLoadReader {
    private pos = 0;
    private readonly crc = new Crc32();
    constructor(private readonly data: Uint8Array) {
        this.crc.init();
    }
    u32(): number {
        const v = new DataView(this.data.buffer, this.data.byteOffset + this.pos).getUint32(0, true);
        this.crc.update(this.data, this.pos, this.pos + 4);
        this.pos += 4;
        return v;
    }
    u8(): number {
        this.crc.update(this.data, this.pos, this.pos + 1);
        return this.data[this.pos++]!;
    }
    finalize(): number {
        return this.crc.finalize();
    }
    get bytesRead(): number {
        return this.pos;
    }
}

/** block.cpp:153-212 — returns file offset immediately after compressed block payload */
export function getBlockEndOffset(source: RandomAccessSource, offset: number, version: InnoVersion): number {
    const headerBytes = source.readRangeSync(offset, offset + 16);
    const crcReader = new CrcLoadReader(headerBytes.subarray(4));
    let storedSize: number;
    if (version.atLeast(4, 0, 9)) {
        storedSize = crcReader.u32();
        crcReader.u8();
    } else {
        throw new InnoFormatError("pre-4.0.9 block format not supported in M2", offset);
    }
    return offset + 4 + crcReader.bytesRead + storedSize;
}

export async function decompressBlockStream(
    source: RandomAccessSource,
    offset: number,
    version: InnoVersion,
    lzmaDecoder?: UnpackDecoder,
): Promise<Uint8Array> {
    const headerBytes = source.readRangeSync(offset, offset + 16);
    const expectedChecksum = readU32At(headerBytes);
    const crcReader = new CrcLoadReader(headerBytes.subarray(4));

    let storedSize: number;
    let compression: number;
    if (version.atLeast(4, 0, 9)) {
        storedSize = crcReader.u32();
        const compressed = crcReader.u8();
        compression = compressed
            ? version.atLeast(4, 1, 6)
                ? BlockCompression.LZMA1
                : BlockCompression.Zlib
            : BlockCompression.Stored;
    } else {
        throw new InnoFormatError("pre-4.0.9 block format not supported in M2", offset);
    }
    if (crcReader.finalize() !== expectedChecksum) {
        throw new InnoFormatError("block header CRC32 mismatch", offset);
    }

    const blockStart = offset + 4 + crcReader.bytesRead;
    const rawBlockData = source.readRangeSync(blockStart, blockStart + storedSize);
    // block.cpp:194-207 — inno_block_filter sits between restrict and decompressor (CRC on stored bytes)
    const payload = stripBlockCrcFrames(rawBlockData);
    switch (compression) {
        case BlockCompression.Stored:
            return payload.slice();
        case BlockCompression.Zlib:
            return inflateZlib(payload);
        case BlockCompression.LZMA1:
            if (!lzmaDecoder) throw new InnoFormatError("LZMA block requires UnpackDecoder", offset);
            if (payload.byteLength < 5) {
                throw new InnoFormatError("LZMA block too short for props", offset);
            }
            return lzmaDecoder.decode(
                UNPACK_LZMA1,
                payload.subarray(5),
                payload.subarray(0, 5),
            );
        default:
            throw new InnoFormatError(`unknown block compression ${compression}`, offset);
    }
}
