/**
 * Loader offset table — ported from innoextract loader/offsets.cpp + loader/exereader.cpp.
 */

import { Crc32 } from "../unpack/checksums";
import { BinaryReader, readU32At } from "./binary-reader";
import type { RandomAccessSource } from "../unpack/source";
import { INNO_VERSION, type VersionConstant } from "./version";

const SETUP_LOADER_HEADER_OFFSET = 0x30; // offsets.cpp:64
const SETUP_LOADER_HEADER_MAGIC = 0x6f6e6e49; // offsets.cpp:65 "Inno"
const RESOURCE_NAME_INSTALLER = 11111; // offsets.cpp:62
const TYPE_DATA = 10; // exereader.hpp:67
const DEFAULT_LANGUAGE = 0xffffffff; // exereader.hpp:78

const KNOWN_LOADER_MAGICS: { magic: number[]; version: VersionConstant }[] = [
    { magic: [0x72, 0x44, 0x6c, 0x50, 0x74, 0x53, 0x30, 0x32, 0x87, 0x65, 0x56, 0x78], version: INNO_VERSION(1, 2, 10) },
    { magic: [0x72, 0x44, 0x6c, 0x50, 0x74, 0x53, 0x30, 0x34, 0x87, 0x65, 0x56, 0x78], version: INNO_VERSION(4, 0, 0) },
    { magic: [0x72, 0x44, 0x6c, 0x50, 0x74, 0x53, 0x30, 0x35, 0x87, 0x65, 0x56, 0x78], version: INNO_VERSION(4, 0, 3) },
    { magic: [0x72, 0x44, 0x6c, 0x50, 0x74, 0x53, 0x30, 0x36, 0x87, 0x65, 0x56, 0x78], version: INNO_VERSION(4, 0, 10) },
    { magic: [0x72, 0x44, 0x6c, 0x50, 0x74, 0x53, 0x30, 0x37, 0x87, 0x65, 0x56, 0x78], version: INNO_VERSION(4, 1, 6) },
    { magic: [0x72, 0x44, 0x6c, 0x50, 0x74, 0x53, 0xcd, 0xe6, 0xd7, 0x7b, 0x0b, 0x2a], version: INNO_VERSION(5, 1, 5) },
    { magic: [0x6e, 0x53, 0x35, 0x57, 0x37, 0x64, 0x54, 0x83, 0xaa, 0x1b, 0x0f, 0x6a], version: INNO_VERSION(5, 1, 5) },
];

export interface InnoOffsets {
    headerOffset: number;
    dataOffset: number;
    foundMagic: boolean;
    loaderVersion: VersionConstant;
}

function identifyLoaderVersion(magic: Uint8Array): VersionConstant {
    for (const entry of KNOWN_LOADER_MAGICS) {
        let ok = true;
        for (let i = 0; i < 12; i++) {
            if (magic[i] !== entry.magic[i]) {
                ok = false;
                break;
            }
        }
        if (ok) return entry.version;
    }
    return 0xffffffff;
}

function findResourceEntry(reader: BinaryReader, id: number): number {
    reader.skip(12);
    const nbnames = reader.u16();
    const nbids = reader.u16();
    if (id === DEFAULT_LANGUAGE) {
        reader.skip(4);
        return reader.u32();
    }
    reader.skip(nbnames * 8);
    for (let i = 0; i < nbids; i++) {
        const entryId = reader.u32();
        const entryOffset = reader.u32();
        if (entryId === id) return entryOffset;
    }
    return 0;
}

function getResourceTable(entry: number, resourceOffset: number): { isTable: boolean; offset: number } {
    return { isTable: (entry & 0x80000000) !== 0, offset: (entry & 0x7fffffff) + resourceOffset };
}

function loadPeHeader(source: RandomAccessSource) {
    const mz = source.readRangeSync(0, 2);
    if (mz[0] !== 0x4d || mz[1] !== 0x5a) return null;
    const peOff = readU32At(source.readRangeSync(0x3c, 0x40));
    const pe = source.readRangeSync(peOff, peOff + 0x200);
    const pr = new BinaryReader(pe);
    if (pr.u32() !== 0x00004550) return null;
    pr.skip(2); // machine
    const nsections = pr.u16();
    pr.skip(12); // timestamp + sym table + nsyms
    const optionalHeaderSize = pr.u16();
    pr.skip(2); // characteristics
    const sectionTableOffset = peOff + pr.pos + optionalHeaderSize;
    const optionalHeaderMagic = pr.u16();
    if (optionalHeaderMagic === 0x20b) pr.skip(106);
    else pr.skip(90);
    const ndirectories = pr.u32();
    if (ndirectories < 3) return null;
    pr.skip(16); // 2 * directory_header_size — export + import
    const resourceTableAddress = pr.u32();
    const resourceSize = pr.u32();
    if (!resourceTableAddress || !resourceSize) return null;
    return { nsections, sectionTableOffset, resourceTableAddress };
}

function toFileOffset(source: RandomAccessSource, sectionTableOffset: number, nsections: number, address: number): number {
    const table = source.readRangeSync(sectionTableOffset, sectionTableOffset + nsections * 40);
    const tr = new BinaryReader(table);
    for (let i = 0; i < nsections; i++) {
        tr.skip(8);
        const virtualSize = tr.u32();
        const virtualAddress = tr.u32();
        tr.skip(4);
        const rawAddress = tr.u32();
        tr.skip(16);
        if (address >= virtualAddress && address < virtualAddress + virtualSize) {
            return address + rawAddress - virtualAddress;
        }
    }
    return 0;
}

function findPeResource(source: RandomAccessSource, name: number, type: number): number {
    const coff = loadPeHeader(source);
    if (!coff) return 0;
    const resourceOffset = toFileOffset(source, coff.sectionTableOffset, coff.nsections, coff.resourceTableAddress);
    if (!resourceOffset) return 0;

    let dr = new BinaryReader(source.readRangeSync(resourceOffset, resourceOffset + 4096), resourceOffset);
    const typeTable = getResourceTable(findResourceEntry(dr, type), resourceOffset);
    if (!typeTable.isTable) return 0;

    dr = new BinaryReader(source.readRangeSync(typeTable.offset, typeTable.offset + 4096), typeTable.offset);
    const nameTable = getResourceTable(findResourceEntry(dr, name), resourceOffset);
    if (!nameTable.isTable) return 0;

    dr = new BinaryReader(source.readRangeSync(nameTable.offset, nameTable.offset + 4096), nameTable.offset);
    const leaf = getResourceTable(findResourceEntry(dr, DEFAULT_LANGUAGE), resourceOffset);
    if (!leaf.offset || leaf.isTable) return 0;

    const lr = new BinaryReader(source.readRangeSync(leaf.offset, leaf.offset + 16), leaf.offset);
    return toFileOffset(source, coff.sectionTableOffset, coff.nsections, lr.u32());
}

function loadOffsetsAt(source: RandomAccessSource, pos: number): InnoOffsets | null {
    const hdr = source.readRangeSync(pos, pos + 64);
    if (hdr.byteLength < 28) return null;
    const magic = hdr.subarray(0, 12);
    const loaderVersion = identifyLoaderVersion(magic);
    const crc = new Crc32();
    crc.init();
    crc.update(magic);
    let off = 12;
    const readU32FromHdr = (): number => {
        const v = readU32At(hdr, off);
        crc.update(hdr, off, off + 4);
        off += 4;
        return v;
    };
    if (loaderVersion >= INNO_VERSION(5, 1, 5)) readU32FromHdr();
    readU32FromHdr();
    readU32FromHdr();
    if (loaderVersion < INNO_VERSION(4, 1, 6)) readU32FromHdr();
    readU32FromHdr();
    readU32FromHdr();
    if (loaderVersion < INNO_VERSION(4, 0, 0)) readU32FromHdr();
    const headerOffset = readU32FromHdr();
    const dataOffset = readU32FromHdr();
    if (loaderVersion >= INNO_VERSION(4, 0, 10) && off + 4 <= hdr.byteLength) {
        const expected = readU32At(hdr, off);
        void expected;
        void crc.finalize();
    }
    return { headerOffset, dataOffset, foundMagic: true, loaderVersion };
}

function loadFromExeFile(source: RandomAccessSource): InnoOffsets | null {
    const magic = readU32At(source.readRangeSync(SETUP_LOADER_HEADER_OFFSET, SETUP_LOADER_HEADER_OFFSET + 4));
    if (magic !== SETUP_LOADER_HEADER_MAGIC) return null;
    const ptr = source.readRangeSync(SETUP_LOADER_HEADER_OFFSET + 4, SETUP_LOADER_HEADER_OFFSET + 12);
    const offsetTableOffset = readU32At(ptr);
    const notOffsetTableOffset = readU32At(ptr, 4);
    if (offsetTableOffset !== (~notOffsetTableOffset >>> 0)) return null;
    return loadOffsetsAt(source, offsetTableOffset);
}

export function loadOffsets(source: RandomAccessSource): InnoOffsets {
    return loadFromExeFile(source) ?? loadFromExeResource(source) ?? {
        headerOffset: 0,
        dataOffset: 0,
        foundMagic: false,
        loaderVersion: 0,
    };
}

function loadFromExeResource(source: RandomAccessSource): InnoOffsets | null {
    const resourceOffset = findPeResource(source, RESOURCE_NAME_INSTALLER, TYPE_DATA);
    if (!resourceOffset) return null;
    return loadOffsetsAt(source, resourceOffset);
}
