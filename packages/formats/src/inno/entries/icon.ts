/** setup/icon.cpp */

import type { BinaryReader } from "../binary-reader";
import type { ParseContext } from "../context";
import { loadConditionData, loadVersionData } from "./item";

export interface IconEntry {
    name: string;
    filename: string;
    parameters: string;
    workingDir: string;
    iconFile: string;
    comment: string;
    appUserModelId: string;
    iconIndex: number;
    showCommand: number;
    closeOnExit: number;
    hotkey: number;
    options: number;
}

export function loadIconEntry(r: BinaryReader, ctx: ParseContext): IconEntry {
    const v = ctx.version;
    const bits = v.bits();
    const cp = ctx.codepage;
    if (v.value < 0x01030000) r.u32();
    const name = r.encodedString(cp);
    const filename = r.encodedString(cp);
    const parameters = r.encodedString(cp);
    const workingDir = r.encodedString(cp);
    const iconFile = r.encodedString(cp);
    const comment = r.encodedString(cp);
    loadConditionData(r, ctx);
    const appUserModelId = v.atLeast(5, 3, 5) ? r.encodedString(cp) : "";
    if (v.atLeast(6, 1, 0)) r.readBytes(16);
    loadVersionData(r, ctx);
    const iconIndex = r.loadI32(bits);
    const showCommand = v.atLeast(1, 3, 24) ? r.loadI32(bits) : 1;
    const closeOnExit = v.atLeast(1, 3, 15) ? r.storedEnum([0, 1, 2], 0) : 0;
    const hotkey = v.atLeast(2, 0, 7) ? r.u16() : 0;
    const fr = r.storedFlagReader(bits);
    fr.add(1 << 0);
    fr.add(1 << 1);
    if (bits !== 16) fr.add(1 << 2);
    if (v.atLeast(5, 0, 3) && v.value < 0x06030000) fr.add(1 << 3);
    if (v.atLeast(5, 4, 2)) fr.add(1 << 4);
    if (v.atLeast(5, 5, 0)) fr.add(1 << 5);
    if (v.atLeast(6, 1, 0)) fr.add(1 << 6);
    return {
        name,
        filename,
        parameters,
        workingDir,
        iconFile,
        comment,
        appUserModelId,
        iconIndex,
        showCommand,
        closeOnExit,
        hotkey,
        options: fr.finalize(),
    };
}

export function skipIconEntry(r: BinaryReader, ctx: ParseContext): void {
    loadIconEntry(r, ctx);
}
