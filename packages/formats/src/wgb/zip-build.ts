/**
 * Store-only ZIP writer — lifted from tools/gog-to-wgb.ts (Uint8Array variant, hoisted CRC table).
 */

const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        table[i] = c;
    }
    return table;
})();

export function crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
        crc = CRC32_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
    nameBytes: Uint8Array;
    data: Uint8Array;
    crc: number;
    offset: number;
}

const ZIP_MAX_U32 = 0xffffffff;
const ZIP_MAX_U16 = 0xffff;

export function buildZip(files: Map<string, Uint8Array>): Uint8Array {
    if (files.size > ZIP_MAX_U16) {
        throw new Error(`WGB zip: too many files (${files.size} > ${ZIP_MAX_U16})`);
    }

    const parts: Uint8Array[] = [];
    const entries: ZipEntry[] = [];
    let offset = 0;

    for (const [name, data] of files) {
        if (data.length > ZIP_MAX_U32) {
            throw new Error(`WGB zip: file "${name}" exceeds 4 GiB`);
        }
        const nameBytes = new TextEncoder().encode(name);
        const entrySize = 30 + nameBytes.length + data.length;
        if (offset > ZIP_MAX_U32 || entrySize > ZIP_MAX_U32 - offset) {
            throw new Error(`WGB zip: archive exceeds 4 GiB (local header offset overflow)`);
        }
        const lfh = new Uint8Array(30);
        const lv = new DataView(lfh.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true);
        lv.setUint16(8, 0, true);
        const fileCrc = crc32(data);
        lv.setUint32(14, fileCrc, true);
        lv.setUint32(18, data.length, true);
        lv.setUint32(22, data.length, true);
        lv.setUint16(26, nameBytes.length, true);
        entries.push({ nameBytes, data, crc: fileCrc, offset });
        parts.push(lfh, nameBytes, data);
        offset += entrySize;
    }

    const cdOffset = offset;
    if (cdOffset > ZIP_MAX_U32) {
        throw new Error(`WGB zip: central directory offset exceeds 4 GiB`);
    }
    let cdSize = 0;
    for (const e of entries) {
        if (e.offset > ZIP_MAX_U32) {
            throw new Error(`WGB zip: entry "${new TextDecoder().decode(e.nameBytes)}" offset exceeds 4 GiB`);
        }
        const cdEntrySize = 46 + e.nameBytes.length;
        if (cdSize > ZIP_MAX_U32 - cdEntrySize) {
            throw new Error(`WGB zip: central directory exceeds 4 GiB`);
        }
        const cdh = new Uint8Array(46);
        const dv = new DataView(cdh.buffer);
        dv.setUint32(0, 0x02014b50, true);
        dv.setUint16(4, 20, true);
        dv.setUint16(6, 20, true);
        dv.setUint32(16, e.crc, true);
        dv.setUint32(20, e.data.length, true);
        dv.setUint32(24, e.data.length, true);
        dv.setUint16(28, e.nameBytes.length, true);
        dv.setUint32(42, e.offset, true);
        parts.push(cdh, e.nameBytes);
        cdSize += cdEntrySize;
    }
    if (cdOffset > ZIP_MAX_U32 - cdSize - 22) {
        throw new Error(`WGB zip: end-of-central-directory record offset exceeds 4 GiB`);
    }

    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, cdOffset, true);
    parts.push(eocd);

    const total = parts.reduce((s, p) => s + p.byteLength, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const p of parts) {
        out.set(p, pos);
        pos += p.byteLength;
    }
    return out;
}
