/** Random-access byte source for Inno parsing (environment-agnostic). */

export interface RandomAccessSource {
    readonly size: number;
    readRangeSync(start: number, end: number): Uint8Array;
}

/** In-memory source — mirrors @obp/formats/zip BufferSource. */
export class BufferSource implements RandomAccessSource {
    readonly size: number;

    constructor(private readonly data: Uint8Array) {
        this.size = data.byteLength;
    }

    readRangeSync(start: number, end: number): Uint8Array {
        const clampedStart = Math.max(0, Math.min(start, this.size));
        const clampedEnd = Math.max(clampedStart, Math.min(end, this.size));
        return this.data.subarray(clampedStart, clampedEnd);
    }
}
