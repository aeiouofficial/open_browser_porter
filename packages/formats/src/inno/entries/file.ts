/** setup/file.cpp */

import type { BinaryReader } from "../binary-reader";
import type { ParseContext } from "../context";
import { loadConditionData, loadVersionData } from "./item";

export interface FileEntry {
    source: string;
    destination: string;
    installFontName: string;
    strongAssemblyName: string;
    components: string;
    tasks: string;
    languages: string;
    check: string;
    afterInstall: string;
    beforeInstall: string;
    location: number;
    attributes: number;
    externalSize: bigint;
    permission: number;
    options: number;
    type: number;
    /** GOG Galaxy multipart — extra data_entry indices concatenated after `location`. */
    additionalLocations: number[];
    /** Total uncompressed size after Galaxy part assembly (0 = derive from data entries). */
    assemblySize: bigint;
    galaxyChecksumType: "md5" | "none";
    galaxyChecksum: Uint8Array;
}

export function loadFileEntry(r: BinaryReader, ctx: ParseContext): FileEntry {
    const v = ctx.version;
    const bits = v.bits();
    const cp = ctx.codepage;
    if (v.value < 0x01030000) r.u32();
    const source = r.encodedString(cp);
    const destination = r.encodedString(cp);
    const installFontName = r.encodedString(cp);
    const strongAssemblyName = v.atLeast(5, 2, 5) ? r.encodedString(cp) : "";
    const condition = loadConditionData(r, ctx);
    loadVersionData(r, ctx);
    const location = r.loadU32(bits);
    const attributes = r.loadU32(bits);
    const externalSize = v.atLeast(4, 0, 0) ? r.u64() : BigInt(r.u32());
    if (v.value < 0x03000500) {
        r.storedEnum([0, 1, 2, 3], 0);
    }
    const permission = v.atLeast(4, 1, 0) ? r.i16() : -1;
    const fr = r.storedFlagReader(bits);
    fr.add(1 << 0);
    fr.add(1 << 1);
    fr.add(1 << 2);
    fr.add(1 << 3);
    if (bits !== 16) {
        fr.add(1 << 4);
        fr.add(1 << 5);
        fr.add(1 << 6);
    }
    fr.add(1 << 7);
    fr.add(1 << 8);
    if (v.atLeast(1, 2, 5)) fr.add(1 << 9);
    if (v.atLeast(1, 2, 6)) fr.add(1 << 10);
    if (v.atLeast(1, 3, 21)) {
        fr.add(1 << 11);
        fr.add(1 << 12);
    }
    if (v.atLeast(1, 3, 25)) fr.add(1 << 13);
    if (v.atLeast(2, 0, 5)) fr.add(1 << 14);
    if (v.atLeast(3, 0, 1)) fr.add(1 << 15);
    if (v.atLeast(3, 0, 5)) {
        fr.add(1 << 16);
        fr.add(1 << 17);
        fr.add(1 << 18);
    }
    if (v.atLeast(4, 0, 0) || (v.isIsx() && v.atLeast(3, 0, 6, 1))) fr.add(1 << 19);
    if (v.atLeast(4, 0, 5)) fr.add(1 << 20);
    if (v.atLeast(4, 1, 8)) fr.add(1 << 21);
    if (v.atLeast(4, 2, 1)) fr.add(1 << 22);
    if (v.atLeast(4, 2, 5)) fr.add(1 << 23);
    if (v.atLeast(5, 0, 3)) fr.add(1 << 24);
    if (v.atLeast(5, 1, 0)) fr.add(1 << 25);
    if (v.atLeast(5, 1, 2)) {
        fr.add(1 << 26);
        fr.add(1 << 27);
    }
    if (v.atLeast(5, 2, 0)) {
        fr.add(1 << 28);
        fr.add(1 << 29);
        fr.add(1 << 30);
    }
    if (v.atLeast(5, 2, 5)) fr.add(1 << 31);
    const options = fr.finalize();
    const type = r.storedEnum([0, 1], 0);
    return {
        source,
        destination,
        installFontName,
        strongAssemblyName,
        components: condition.components,
        tasks: condition.tasks,
        languages: condition.languages,
        check: condition.check,
        afterInstall: condition.afterInstall,
        beforeInstall: condition.beforeInstall,
        location,
        attributes,
        externalSize,
        permission,
        options,
        type,
        additionalLocations: [],
        assemblySize: 0n,
        galaxyChecksumType: "none",
        galaxyChecksum: new Uint8Array(0),
    };
}

export function skipFileEntry(r: BinaryReader, ctx: ParseContext): void {
    loadFileEntry(r, ctx);
}
