/** setup/item.cpp — load_condition_data + load_version_data */

import type { BinaryReader } from "../binary-reader";
import type { ParseContext } from "../context";
import { loadWindowsVersionRange } from "./windows";

export interface ItemConditionFields {
    components: string;
    tasks: string;
    languages: string;
    check: string;
    afterInstall: string;
    beforeInstall: string;
}

export function loadConditionData(r: BinaryReader, ctx: ParseContext): ItemConditionFields {
    const v = ctx.version;
    const cp = ctx.codepage;
    const fields: ItemConditionFields = {
        components: "",
        tasks: "",
        languages: "",
        check: "",
        afterInstall: "",
        beforeInstall: "",
    };
    if (v.atLeast(2, 0, 0) || (v.isIsx() && v.atLeast(1, 3, 8))) fields.components = r.encodedString(cp);
    if (v.atLeast(2, 0, 0) || (v.isIsx() && v.atLeast(1, 3, 17))) fields.tasks = r.encodedString(cp);
    if (v.atLeast(4, 0, 1)) fields.languages = r.encodedString(cp);
    if (v.atLeast(4, 0, 0) || (v.isIsx() && v.atLeast(1, 3, 24))) fields.check = r.encodedString(cp);
    if (v.atLeast(4, 1, 0)) {
        fields.afterInstall = r.encodedString(cp);
        fields.beforeInstall = r.encodedString(cp);
    }
    return fields;
}

export function skipConditionData(r: BinaryReader, ctx: ParseContext): void {
    loadConditionData(r, ctx);
}

/** setup/item.hpp:55-57 */
export function loadVersionData(r: BinaryReader, ctx: ParseContext) {
    return loadWindowsVersionRange(r, ctx.version.atLeast(1, 3, 19));
}

export function skipVersionData(r: BinaryReader, ctx: ParseContext): void {
    loadVersionData(r, ctx);
}
