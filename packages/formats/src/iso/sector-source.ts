/**
 * CD/DVD image sector addressing.
 *
 * A disc image stores 2048-byte logical blocks, but the on-disk sector size and
 * the byte offset of the user-data field within each raw sector depend on the
 * track mode the image was dumped in:
 *
 *   plain ISO (MODE1/2048)   rawSectorSize 2048   userOffset  0   (clean .iso)
 *   MODE1/2352               rawSectorSize 2352   userOffset 16   (raw .bin, 12 sync + 4 header)
 *   MODE2/2352 Form1         rawSectorSize 2352   userOffset 24   (12 sync + 4 header + 8 subheader)
 *   MODE2/2336               rawSectorSize 2336   userOffset  8   (8 subheader)
 *
 * `IsoImage` hides that: callers address the filesystem in logical 2048-byte
 * blocks (LBA) and we map each one back to its raw byte range. ISO9660 always
 * places the first volume descriptor at logical sector 16.
 */

import type { RandomAccessSource } from "../unpack/source";

/** Bytes per logical block in an ISO9660 filesystem. */
export const LOGICAL_BLOCK_SIZE = 2048;

/** Logical sector number of the first volume descriptor (System Area is 16 sectors). */
export const FIRST_VD_LBA = 16;

const CD001 = [0x43, 0x44, 0x30, 0x30, 0x31]; // "CD001"

export interface SectorLayout {
    /** Bytes per raw sector on the image. */
    rawSectorSize: number;
    /** Byte offset of the 2048-byte user-data field within a raw sector. */
    userOffset: number;
    /** Human-readable description for logging. */
    label: string;
}

export const LAYOUT_ISO: SectorLayout = { rawSectorSize: 2048, userOffset: 0, label: "MODE1/2048 (plain ISO)" };
export const LAYOUT_MODE1_2352: SectorLayout = { rawSectorSize: 2352, userOffset: 16, label: "MODE1/2352 (raw)" };
export const LAYOUT_MODE2_2352: SectorLayout = { rawSectorSize: 2352, userOffset: 24, label: "MODE2/2352 Form1 (raw)" };
export const LAYOUT_MODE2_2336: SectorLayout = { rawSectorSize: 2336, userOffset: 8, label: "MODE2/2336" };

// Probed in order; the first whose VD slot carries the "CD001" magic wins.
const CANDIDATE_LAYOUTS: SectorLayout[] = [
    LAYOUT_ISO,
    LAYOUT_MODE1_2352,
    LAYOUT_MODE2_2352,
    LAYOUT_MODE2_2336,
];

function hasCd001At(source: RandomAccessSource, byteOffset: number): boolean {
    // The volume descriptor starts with a 1-byte type, then the 5-byte "CD001".
    const probe = source.readRangeSync(byteOffset + 1, byteOffset + 1 + CD001.length);
    if (probe.length < CD001.length) return false;
    for (let i = 0; i < CD001.length; i++) {
        if (probe[i] !== CD001[i]) return false;
    }
    return true;
}

/**
 * Detect the sector layout of a disc image by locating the "CD001" magic at the
 * first-volume-descriptor sector under each candidate framing. Returns null when
 * the image is not ISO9660 (e.g. a pure audio disc or unknown filesystem).
 */
export function detectSectorLayout(source: RandomAccessSource): SectorLayout | null {
    for (const layout of CANDIDATE_LAYOUTS) {
        const vdByteOffset = FIRST_VD_LBA * layout.rawSectorSize + layout.userOffset;
        if (vdByteOffset + LOGICAL_BLOCK_SIZE > source.size) continue;
        if (hasCd001At(source, vdByteOffset)) return layout;
    }
    return null;
}

/**
 * A mounted disc image: maps logical block addresses to raw byte ranges through
 * its detected (or supplied) sector layout.
 */
export class IsoImage {
    readonly layout: SectorLayout;
    private readonly source: RandomAccessSource;
    /** Byte offset within the source where the data track begins (0 for plain images). */
    private readonly trackBaseByte: number;

    constructor(source: RandomAccessSource, layout: SectorLayout, trackBaseByte = 0) {
        this.source = source;
        this.layout = layout;
        this.trackBaseByte = trackBaseByte;
    }

    /** Mount, auto-detecting the sector layout. Throws when not ISO9660. */
    static mount(source: RandomAccessSource): IsoImage {
        const layout = detectSectorLayout(source);
        if (!layout) {
            throw new Error("not an ISO9660 image (no CD001 volume descriptor at sector 16)");
        }
        return new IsoImage(source, layout);
    }

    private byteOffsetOfSector(lba: number): number {
        return this.trackBaseByte + lba * this.layout.rawSectorSize + this.layout.userOffset;
    }

    /** Read `count` logical 2048-byte blocks starting at `lba` into one contiguous buffer. */
    readBlocks(lba: number, count: number): Uint8Array {
        if (this.layout.rawSectorSize === LOGICAL_BLOCK_SIZE && this.layout.userOffset === 0 && this.trackBaseByte === 0) {
            // Plain ISO: user data is contiguous, read the whole span at once.
            const start = lba * LOGICAL_BLOCK_SIZE;
            return this.source.readRangeSync(start, start + count * LOGICAL_BLOCK_SIZE);
        }
        // Raw image: gather the user-data window out of each padded sector.
        const out = new Uint8Array(count * LOGICAL_BLOCK_SIZE);
        for (let i = 0; i < count; i++) {
            const off = this.byteOffsetOfSector(lba + i);
            const chunk = this.source.readRangeSync(off, off + LOGICAL_BLOCK_SIZE);
            out.set(chunk.subarray(0, LOGICAL_BLOCK_SIZE), i * LOGICAL_BLOCK_SIZE);
        }
        return out;
    }

    /** Read one logical block. */
    readBlock(lba: number): Uint8Array {
        return this.readBlocks(lba, 1);
    }

    /**
     * Read a file's extent (`size` bytes starting at `lba`) into one buffer.
     * Prefer `readExtentChunked` for large extents to keep memory bounded.
     */
    readExtent(lba: number, size: number): Uint8Array {
        const blocks = Math.ceil(size / LOGICAL_BLOCK_SIZE);
        const data = this.readBlocks(lba, blocks);
        return data.length === size ? data : data.subarray(0, size);
    }

    /**
     * Stream a file's extent to `onChunk` in slices of at most `chunkBlocks`
     * logical blocks (default 4096 = 8 MiB). The last chunk is trimmed to `size`.
     */
    readExtentChunked(
        lba: number,
        size: number,
        onChunk: (chunk: Uint8Array) => void,
        chunkBlocks = 4096,
    ): void {
        const totalBlocks = Math.ceil(size / LOGICAL_BLOCK_SIZE);
        let remaining = size;
        for (let block = 0; block < totalBlocks; block += chunkBlocks) {
            const blocks = Math.min(chunkBlocks, totalBlocks - block);
            const buf = this.readBlocks(lba + block, blocks);
            const take = Math.min(remaining, buf.length);
            onChunk(take === buf.length ? buf : buf.subarray(0, take));
            remaining -= take;
        }
    }
}
