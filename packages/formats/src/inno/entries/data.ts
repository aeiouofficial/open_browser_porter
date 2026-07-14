/** setup/data.cpp — FileLocationEntry */

import type { BinaryReader } from "../binary-reader";
import type { ParseContext } from "../context";

export interface DataEntry {
    firstSlice: number;
    lastSlice: number;
    sortOffset: number;
    fileOffset: bigint;
    fileSize: bigint;
    chunkSize: bigint;
    uncompressedSize: bigint;
    checksum: Uint8Array;
    checksumType: "sha256" | "sha1" | "md5" | "crc32" | "adler32";
    timestamp: bigint;
    fileVersion: bigint;
    options: number;
    sign: number;
    chunkCompressed: boolean;
    /** GOG Galaxy part — deflate wrapper around chunk payload bytes for this file slice. */
    zlibFilter: boolean;
}

/** setup/data.cpp:116 — FILETIME offset */
const FILETIME_OFFSET = 0x19db1ded53e8000n;

export function loadDataEntry(r: BinaryReader, ctx: ParseContext): DataEntry {
    const v = ctx.version;
    const bits = v.bits();
    let firstSlice = r.loadU32(bits);
    let lastSlice = r.loadU32(bits);
    if (v.value < 0x04000000) {
        if (firstSlice >= 1 && lastSlice >= 1) {
            firstSlice--;
            lastSlice--;
        }
    }
    const sortOffset = r.u32();
    const fileOffset = v.atLeast(4, 0, 1) ? r.u64() : 0n;
    const fileSize = v.atLeast(4, 0, 0) ? r.u64() : BigInt(r.u32());
    const chunkSize = v.atLeast(4, 0, 0) ? r.u64() : BigInt(r.u32());
    const uncompressedSize = fileSize;
    let checksum: Uint8Array;
    let checksumType: DataEntry["checksumType"];
    if (v.atLeast(6, 4, 0)) {
        checksum = r.readBytes(32);
        checksumType = "sha256";
    } else if (v.atLeast(5, 3, 9)) {
        checksum = r.readBytes(20);
        checksumType = "sha1";
    } else if (v.atLeast(4, 2, 0)) {
        checksum = r.readBytes(16);
        checksumType = "md5";
    } else if (v.atLeast(4, 0, 1)) {
        checksum = new Uint8Array(4);
        new DataView(checksum.buffer).setUint32(0, r.u32(), true);
        checksumType = "crc32";
    } else {
        checksum = new Uint8Array(4);
        new DataView(checksum.buffer).setUint32(0, r.u32(), true);
        checksumType = "adler32";
    }
    let timestamp: bigint;
    if (bits === 16) {
        r.u16();
        r.u16();
        timestamp = 0n;
    } else {
        let filetime = r.i64();
        if (filetime < FILETIME_OFFSET) filetime = 0n;
        else filetime -= FILETIME_OFFSET;
        timestamp = filetime / 10000000n;
    }
    const fileVersionMs = r.u32();
    const fileVersionLs = r.u32();
    const fileVersion = (BigInt(fileVersionMs) << 32n) | BigInt(fileVersionLs);
    const fr = r.storedFlagReader(bits);
    fr.add(1 << 0);
    fr.add(1 << 1);
    if (v.atLeast(2, 0, 17) && v.value < 0x04000100) fr.add(1 << 2);
    if (v.atLeast(4, 0, 10)) fr.add(1 << 3);
    if (v.atLeast(4, 1, 0)) fr.add(1 << 4);
    if (v.atLeast(4, 1, 8)) fr.add(1 << 5);
    if (v.atLeast(4, 2, 0)) fr.add(1 << 6);
    if (v.atLeast(4, 2, 2)) fr.add(1 << 7);
    let presetChunkCompressed = !v.atLeast(4, 2, 5);
    if (v.atLeast(4, 2, 5)) fr.add(1 << 8);
    else presetChunkCompressed = true;
    if (v.atLeast(5, 1, 13)) fr.add(1 << 9);
    if (v.atLeast(5, 5, 7) && v.value < 0x06030000) {
        fr.add(1 << 10);
        fr.add(1 << 11);
    }
    let options = fr.finalize();
    if (presetChunkCompressed) options |= 1 << 8;
    let sign = 0;
    if (v.atLeast(6, 3, 0)) {
        sign = r.storedEnum([0, 1, 2, 3], 0);
    } else if (options & (1 << 11)) sign = 2;
    else if (options & (1 << 10)) sign = 1;
    return {
        firstSlice,
        lastSlice,
        sortOffset,
        fileOffset,
        fileSize,
        chunkSize,
        uncompressedSize,
        checksum,
        checksumType,
        timestamp,
        fileVersion,
        options,
        sign,
        chunkCompressed: (options & (1 << 8)) !== 0,
        zlibFilter: false,
    };
}

export function skipDataEntry(r: BinaryReader, ctx: ParseContext): void {
    loadDataEntry(r, ctx);
}
