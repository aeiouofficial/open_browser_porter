const DROP_DEST_PREFIXES = [
    "{tmp}", "{sys}", "{win}", "{fonts}", "{group}",
    "{commonappdata}", "{userappdata}", "{localappdata}",
];

export interface NormalizeInnoDestinationOptions {
    /** GOG Galaxy reassembly yields bare relative paths (e.g. SS2.exe, Data\foo). */
    allowBareRelative?: boolean;
}

function normalizeSafeRelativePath(path: string): string | null {
    const normalized = path.replace(/\//g, "\\");
    if (!normalized || normalized.startsWith("\\") || /^[a-z]:\\/i.test(normalized)) return null;

    const parts = normalized.split("\\");
    if (parts.length === 0) return null;
    for (const part of parts) {
        if (!part || part === "." || part === "..") return null;
    }
    return parts.join("/");
}

export function normalizeInnoDestination(
    dest: string,
    opts: NormalizeInnoDestinationOptions = {},
): string | null {
    if (!dest) return null;
    const normalized = dest.replace(/\//g, "\\");
    const lower = normalized.toLowerCase();

    if (!lower.startsWith("{app}")) {
        if (normalized.includes("{")) {
            for (const p of DROP_DEST_PREFIXES) {
                if (lower.startsWith(p.toLowerCase())) return null;
            }
            return null;
        }
        if (!opts.allowBareRelative) return null;
        return normalizeSafeRelativePath(normalized);
    }

    let rel = normalized.slice("{app}".length);
    if (rel.startsWith("\\")) rel = rel.slice(1);
    if (rel.includes("{")) return null;
    return normalizeSafeRelativePath(rel);
}
