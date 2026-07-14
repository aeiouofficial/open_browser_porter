/**
 * GOG Galaxy multipart file metadata — ported from innoextract cli/goggalaxy.cpp.
 */

import type { DataEntry } from "./entries/data";
import type { FileEntry } from "./entries/file";
import type { InnoHeader } from "./header";
import type { LanguageEntry } from "./entries/language";

function parseFunctionCall(code: string, name: string): string[] {
    if (!code) return [];

    const whitespace = /[\s\r\n]/;
    const separator = /[\s\r\n(),']/;

    let start = 0;
    while (start < code.length && whitespace.test(code[start]!)) start++;
    if (start >= code.length) return [];

    let end = start;
    while (end < code.length && !separator.test(code[end]!)) end++;

    let p = end;
    while (p < code.length && whitespace.test(code[p]!)) p++;
    if (p >= code.length || code[p] !== "(") return [];
    if (end - start !== name.length || code.slice(start, end) !== name) return [];

    const arguments_: string[] = [];
    p++;

    for (;;) {
        while (p < code.length && whitespace.test(code[p]!)) p++;
        if (p >= code.length) return arguments_;

        arguments_.push("");

        if (code[p] === "'") {
            p++;
            for (;;) {
                const stringEnd = code.indexOf("'", p);
                if (stringEnd < 0) return arguments_;
                arguments_[arguments_.length - 1] += code.slice(p, stringEnd);
                if (stringEnd + 1 >= code.length) return arguments_;
                p = stringEnd + 1;
                if (code[p] === "'") {
                    arguments_[arguments_.length - 1] += "'";
                    p++;
                } else {
                    break;
                }
            }
        } else {
            let tokenEnd = p;
            while (tokenEnd < code.length && !separator.test(code[tokenEnd]!)) tokenEnd++;
            arguments_[arguments_.length - 1] = code.slice(p, tokenEnd);
            if (tokenEnd >= code.length) return arguments_;
            p = tokenEnd;
        }

        while (p < code.length && whitespace.test(code[p]!)) p++;
        if (p >= code.length) return arguments_;

        if (code[p] === ")") break;
        if (code[p] === ",") {
            p++;
        } else {
            return arguments_;
        }
    }

    return arguments_;
}

function parseHex(c: string): number {
    const n = c.charCodeAt(0);
    if (n >= 48 && n <= 57) return n - 48;
    if (n >= 97 && n <= 102) return n - 97 + 10;
    if (n >= 65 && n <= 70) return n - 65 + 10;
    return -1;
}

function parseMd5Checksum(hex: string): Uint8Array | null {
    if (hex.length !== 32) return null;
    const out = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
        const a = parseHex(hex[2 * i]!);
        const b = parseHex(hex[2 * i + 1]!);
        if (a < 0 || b < 0) return null;
        out[i] = (a << 4) | b;
    }
    return out;
}

function parseConstraints(input: string): Array<{ name: string; negated: boolean }> {
    const result: Array<{ name: string; negated: boolean }> = [];
    let start = 0;
    while (start < input.length) {
        while (start < input.length && /[\s\r\n]/.test(input[start]!)) start++;
        if (start >= input.length) break;

        let negated = false;
        if (input[start] === "!") {
            negated = true;
            start++;
        }

        let end = input.indexOf("#", start);
        if (end < 0) end = input.length;

        if (end > start) {
            result.push({ name: input.slice(start, end).trim(), negated });
        }
        start = end + 1;
    }
    return result;
}

function isGogInstaller(header: InnoHeader): boolean {
    const hay = [
        header.appPublisher,
        header.appPublisherUrl,
        header.appSupportUrl,
        header.appUpdatesUrl,
    ];
    return hay.some((s) => /gog\.com/i.test(s));
}

export interface GalaxyParseTarget {
    header: InnoHeader;
    files: FileEntry[];
    dataEntries: DataEntry[];
    languages: LanguageEntry[];
}

/** Mutates files/dataEntries in place — call after header + data entries are loaded. */
export function parseGalaxyFiles(target: GalaxyParseTarget, force = false): void {
    if (!force && !isGogInstaller(target.header)) return;

    let fileStart: FileEntry | null = null;
    let remainingParts = 0;
    const allLanguages = new Set<string>();
    let hasLanguageConstraints = false;

    for (const file of target.files) {
        let startInfo = parseFunctionCall(file.beforeInstall, "before_install");
        if (startInfo.length === 0) {
            startInfo = parseFunctionCall(file.beforeInstall, "before_install_dependency");
        }

        if (startInfo.length > 0) {
            if (remainingParts !== 0) remainingParts = 0;

            if (startInfo.length >= 2 && startInfo[1]) {
                file.destination = startInfo[1]!;
            }

            const md5 = parseMd5Checksum(startInfo[0] ?? "");
            if (md5) {
                file.galaxyChecksum = md5;
                file.galaxyChecksumType = "md5";
            }

            file.assemblySize = 0n;
            if (startInfo.length < 3) {
                remainingParts = 1;
                fileStart = file;
            } else {
                const n = parseInt(startInfo[2]!, 10);
                if (!Number.isFinite(n) || n <= 0) {
                    remainingParts = 0;
                } else {
                    remainingParts = n;
                    fileStart = file;
                }
            }
        }

        let partInfo = parseFunctionCall(file.afterInstall, "after_install");
        if (partInfo.length === 0) {
            partInfo = parseFunctionCall(file.afterInstall, "after_install_dependency");
        }

        if (partInfo.length > 0) {
            if (remainingParts === 0) {
                // orphan part — skip
            } else if (file.location >= target.dataEntries.length) {
                remainingParts = 0;
            } else if (partInfo.length < 3) {
                remainingParts = 0;
            } else {
                remainingParts--;
                const data = target.dataEntries[file.location]!;
                const uncompressed = BigInt(partInfo[2]!);
                data.uncompressedSize = uncompressed;
                data.zlibFilter = true;

                if (fileStart) {
                    fileStart.assemblySize += uncompressed;
                }

                if (file !== fileStart && fileStart) {
                    file.destination = "";
                    fileStart.additionalLocations.push(file.location);
                }
            }
        } else if (startInfo.length > 0) {
            remainingParts = 0;
        } else if (remainingParts !== 0) {
            remainingParts = 0;
        }

        if (file.destination) {
            const check = parseFunctionCall(file.check, "check_if_install");
            if (check.length > 0 && check[0]) {
                for (const lang of parseConstraints(check[0]!)) {
                    allLanguages.add(lang.name);
                }
            }
        }

        hasLanguageConstraints = hasLanguageConstraints || file.languages.length > 0;
    }

    if (!allLanguages.size) return;

    if (!hasLanguageConstraints) {
        target.languages.length = 0;
    }
    for (const name of allLanguages) {
        target.languages.push({
            name,
            languageName: name,
            languageId: 0,
            codepage: 0,
            dialogFontSize: 0,
            titleFontSize: 0,
            welcomeFontSize: 0,
            copyrightFontSize: 0,
            rightToLeft: false,
        });
    }
}
