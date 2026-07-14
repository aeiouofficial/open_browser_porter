/** Shared parse context — mirrors innoextract setup/info.hpp. */

import type { InnoHeader } from "./header";
import type { InnoVersion } from "./version";

export interface ParseContext {
    version: InnoVersion;
    codepage: number;
    header: InnoHeader;
}
