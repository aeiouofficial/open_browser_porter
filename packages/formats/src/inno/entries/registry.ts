/** setup/registry.cpp */

import type { BinaryReader } from "../binary-reader";
import type { ParseContext } from "../context";
import { loadConditionData, loadVersionData } from "./item";

export interface RegistryEntry {
    key: string;
    name: string;
    value: Uint8Array;
    hive: number;
    permission: number;
    type: number;
    options: number;
}

export function loadRegistryEntry(r: BinaryReader, ctx: ParseContext): RegistryEntry {
    const v = ctx.version;
    const bits = v.bits();
    const cp = ctx.codepage;
    if (v.value < 0x01030000) r.u32();
    const key = r.encodedString(cp);
    const name = bits !== 16 ? r.encodedString(cp) : "";
    const value = r.binaryString();
    loadConditionData(r, ctx);
    if (v.atLeast(4, 0, 11) && v.value < 0x04010000) r.skipBinaryString();
    loadVersionData(r, ctx);
    const hive = bits !== 16 ? r.u32() & 0x7fffffff : 0;
    const permission = v.atLeast(4, 1, 0) ? r.i16() : -1;
    const type = v.atLeast(5, 2, 5)
        ? r.storedEnum([0, 1, 2, 3, 4, 5, 6], 0)
        : bits !== 16
          ? r.storedEnum([0, 1, 2, 3, 4, 5], 0)
          : r.storedEnum([0, 1], 0);
    const fr = r.storedFlagReader(bits);
    if (bits !== 16) {
        fr.add(1 << 0);
        fr.add(1 << 1);
    }
    fr.add(1 << 2);
    fr.add(1 << 3);
    fr.add(1 << 4);
    if (v.atLeast(1, 2, 6)) fr.add(1 << 5);
    if (v.atLeast(1, 3, 9)) {
        fr.add(1 << 6);
        fr.add(1 << 7);
    }
    if (v.atLeast(1, 3, 12)) fr.add(1 << 8);
    if (v.atLeast(1, 3, 16)) fr.add(1 << 9);
    if (v.atLeast(5, 1, 0)) {
        fr.add(1 << 10);
        fr.add(1 << 11);
    }
    return { key, name, value, hive, permission, type, options: fr.finalize() };
}

export function skipRegistryEntry(r: BinaryReader, ctx: ParseContext): void {
    loadRegistryEntry(r, ctx);
}
