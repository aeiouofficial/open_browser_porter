/**
 * Sequential binary reader — ported from innoextract util/load.hpp + util/storedenum.hpp.
 */

import { InnoFormatError } from "./errors";
import { CP_UTF16LE } from "./version";

const utf16Decoder = new TextDecoder("utf-16le");
const latin1Decoder = new TextDecoder("latin1");

/** Read u32 LE from a possibly-sliced Uint8Array. */
export function readU32At(data: Uint8Array, offset = 0): number {
    return new DataView(data.buffer, data.byteOffset + offset, Math.max(0, data.byteLength - offset)).getUint32(
        0,
        true,
    );
}

/** setup/windows.hpp */
export interface WindowsVersionData {
    major: number;
    minor: number;
    build: number;
}

export interface WindowsVersion {
    winVersion: WindowsVersionData;
    ntVersion: WindowsVersionData;
    ntServicePack: { major: number; minor: number };
}

export interface WindowsVersionRange {
    begin: WindowsVersion;
    end: WindowsVersion;
}

/** util/storedenum.hpp:221-244 — stored_flag_reader */
export class StoredFlagAccumulator {
    private pos = 0;
    private buffer = 0;
    private bytes = 0;
    flags = 0;

    constructor(
        private readonly reader: BinaryReader,
        private readonly padBits: number,
    ) {}

    add(flag: number): void {
        if (this.pos === 0) {
            this.bytes++;
            this.buffer = this.reader.u8();
        }
        if (this.buffer & (1 << this.pos)) {
            this.flags |= flag;
        }
        this.pos = (this.pos + 1) % 8;
    }

    finalize(): number {
        if (this.bytes === 3 && this.padBits === 32) {
            this.reader.u8();
        }
        return this.flags;
    }
}

export class BinaryReader {
    private view: DataView;
    pos = 0;

    constructor(
        private readonly data: Uint8Array,
        private readonly baseOffset = 0,
    ) {
        this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    }

    get offset(): number {
        return this.baseOffset + this.pos;
    }

    get remaining(): number {
        return this.data.byteLength - this.pos;
    }

    seek(abs: number): void {
        if (abs < 0 || abs > this.data.byteLength) {
            throw new InnoFormatError("seek out of range", this.baseOffset + abs);
        }
        this.pos = abs;
    }

    skip(n: number): void {
        this.pos += n;
        if (this.pos > this.data.byteLength) {
            throw new InnoFormatError("unexpected end of stream", this.offset, "skip");
        }
    }

    ensure(n: number): void {
        if (this.pos + n > this.data.byteLength) {
            throw new InnoFormatError("unexpected end of stream", this.offset);
        }
    }

    u8(): number {
        this.ensure(1);
        return this.data[this.pos++]!;
    }

    u16(): number {
        this.ensure(2);
        const v = this.view.getUint16(this.pos, true);
        this.pos += 2;
        return v;
    }

    u32(): number {
        this.ensure(4);
        const v = this.view.getUint32(this.pos, true);
        this.pos += 4;
        return v;
    }

    u64(): bigint {
        this.ensure(8);
        const v = this.view.getBigUint64(this.pos, true);
        this.pos += 8;
        return v;
    }

    i16(): number {
        this.ensure(2);
        const v = this.view.getInt16(this.pos, true);
        this.pos += 2;
        return v;
    }

    i32(): number {
        this.ensure(4);
        const v = this.view.getInt32(this.pos, true);
        this.pos += 4;
        return v;
    }

    i64(): bigint {
        this.ensure(8);
        const v = this.view.getBigInt64(this.pos, true);
        this.pos += 8;
        return v;
    }

    loadU32(bits: number): number {
        if (bits === 8) return this.u8();
        if (bits === 16) return this.u16();
        if (bits === 32) return this.u32();
        return Number(this.u64());
    }

    loadI32(bits: number): number {
        if (bits === 8) {
            this.ensure(1);
            const v = this.view.getInt8(this.pos);
            this.pos += 1;
            return v;
        }
        if (bits === 16) return this.i16();
        if (bits === 32) return this.i32();
        return Number(this.i64());
    }

    storedEnum<T>(values: readonly T[], defaultValue: T): T {
        const index = this.u8();
        if (index < values.length) return values[index]!;
        return defaultValue;
    }

    storedFlags(values: readonly number[], padBits = 32): number {
        const count = values.length;
        const byteCount = Math.ceil(count / 8);
        const bytes: number[] = [];
        for (let i = 0; i < byteCount; i++) bytes.push(this.u8());
        if (byteCount === 3 && padBits === 32) this.u8();
        let result = 0;
        for (let i = 0; i < count; i++) {
            if (bytes[Math.floor(i / 8)]! & (1 << (i % 8))) {
                result |= values[i]!;
            }
        }
        return result;
    }

    storedFlagReader(padBits: number): StoredFlagAccumulator {
        return new StoredFlagAccumulator(this, padBits);
    }

    loadBool(): boolean {
        return this.u8() !== 0;
    }

    binaryString(): Uint8Array {
        const length = this.u32();
        this.ensure(length);
        const out = this.data.subarray(this.pos, this.pos + length);
        this.pos += length;
        return out.slice();
    }

    skipBinaryString(): void {
        const length = this.u32();
        this.skip(length);
    }

    encodedString(codepage: number): string {
        const raw = this.binaryString();
        if (codepage === CP_UTF16LE) return utf16Decoder.decode(raw);
        return latin1Decoder.decode(raw);
    }

    ansiString(): string {
        return latin1Decoder.decode(this.binaryString());
    }

    readBytes(n: number): Uint8Array {
        this.ensure(n);
        const out = this.data.subarray(this.pos, this.pos + n);
        this.pos += n;
        return out.slice();
    }

    loadWindowsVersionData(versionAtLeast11319: boolean): WindowsVersionData {
        const build = versionAtLeast11319 ? this.u16() : 0;
        const minor = this.u8();
        const major = this.u8();
        return { major, minor, build };
    }

    loadWindowsVersion(versionAtLeast11319: boolean): WindowsVersion {
        const winVersion = this.loadWindowsVersionData(versionAtLeast11319);
        const ntVersion = this.loadWindowsVersionData(versionAtLeast11319);
        let ntServicePack = { major: 0, minor: 0 };
        if (versionAtLeast11319) {
            ntServicePack = { minor: this.u8(), major: this.u8() };
        }
        return { winVersion, ntVersion, ntServicePack };
    }

    loadWindowsVersionRange(versionAtLeast11319: boolean): WindowsVersionRange {
        return {
            begin: this.loadWindowsVersion(versionAtLeast11319),
            end: this.loadWindowsVersion(versionAtLeast11319),
        };
    }

    isAtEnd(): boolean {
        return this.pos >= this.data.byteLength;
    }
}
