/** setup/language.cpp */

import type { BinaryReader } from "../binary-reader";
import type { ParseContext } from "../context";
import { CP_UTF16LE, INNO_VERSION_EXT } from "../version";

export interface LanguageEntry {
    name: string;
    languageName: string;
    languageId: number;
    codepage: number;
    dialogFontSize: number;
    titleFontSize: number;
    welcomeFontSize: number;
    copyrightFontSize: number;
    rightToLeft: boolean;
}

export function loadLanguageEntry(r: BinaryReader, ctx: ParseContext): LanguageEntry {
    const v = ctx.version;
    let name = "";
    if (v.atLeast(4, 0, 0)) name = r.encodedString(ctx.codepage);
    const languageNameRaw = r.binaryString();
    if (v.value === INNO_VERSION_EXT(5, 5, 7, 1)) r.skipBinaryString();
    r.skipBinaryString();
    r.skipBinaryString();
    r.skipBinaryString();
    r.skipBinaryString();
    if (v.atLeast(4, 0, 0)) r.skipBinaryString();
    if (v.atLeast(4, 0, 1)) {
        r.skipBinaryString();
        r.skipBinaryString();
        r.skipBinaryString();
    }
    const languageId = r.u32();
    let codepage: number;
    if (v.value < INNO_VERSION_EXT(4, 2, 2, 0)) {
        codepage = 1252;
    } else if (!v.isUnicode()) {
        codepage = r.u32() || 1252;
    } else {
        if (v.value < INNO_VERSION_EXT(5, 3, 0, 0)) r.u32();
        codepage = CP_UTF16LE;
    }
    const dialogFontSize = r.u32();
    if (v.value < INNO_VERSION_EXT(4, 1, 0, 0)) r.u32();
    const titleFontSize = r.u32();
    const welcomeFontSize = r.u32();
    const copyrightFontSize = r.u32();
    if (v.value === INNO_VERSION_EXT(5, 5, 7, 1)) r.u32();
    const rightToLeft = v.atLeast(5, 2, 3) ? r.loadBool() : false;
    const languageName = v.atLeast(4, 2, 2)
        ? new TextDecoder("utf-16le").decode(languageNameRaw)
        : new TextDecoder("latin1").decode(languageNameRaw);
    return {
        name: name || "default",
        languageName,
        languageId,
        codepage,
        dialogFontSize,
        titleFontSize,
        welcomeFontSize,
        copyrightFontSize,
        rightToLeft,
    };
}

export function skipLanguageEntry(r: BinaryReader, ctx: ParseContext): void {
    loadLanguageEntry(r, ctx);
}
