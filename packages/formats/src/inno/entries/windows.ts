/** setup/windows.cpp */

import type { BinaryReader, WindowsVersionRange } from "../binary-reader";
import type { InnoVersion } from "../version";

export function loadWindowsVersionRange(r: BinaryReader, versionAtLeast11319: boolean): WindowsVersionRange {
    return r.loadWindowsVersionRange(versionAtLeast11319);
}

export function loadWindowsVersion(r: BinaryReader, version: InnoVersion) {
    return r.loadWindowsVersion(version.atLeast(1, 3, 19));
}
