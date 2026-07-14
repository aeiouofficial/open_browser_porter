/**
 * GOG junk file filter — lifted from tools/gog-to-wgb.ts.
 */

export const SKIP_DIRS = new Set(["__redist", "webcache", "__support"]);

const SKIP_FILE_PATTERNS = [
    /^gog\.ico$/i,
    /^goggame-.*\.(info|json|script)$/i,
    /^gameinfo$/i,
    /^unins000\.(exe|dat)$/i,
    /^gogbundleuninstall\.(exe|dat)$/i,
    /\.tmp$/i,
];

export function isGogJunk(relPath: string): boolean {
    const parts = relPath.replace(/\\/g, "/").split("/");
    for (const part of parts) {
        if (SKIP_DIRS.has(part.toLowerCase())) return true;
    }
    const filename = parts[parts.length - 1] ?? "";
    return SKIP_FILE_PATTERNS.some((re) => re.test(filename));
}

// Installer/uninstaller/setup-runtime exes that are never the game entrypoint.
// `uninstall` is also matched anywhere in the name (e.g. "GameUninstall.exe").
export const SKIP_EXE = /^(setup|install|unwise|uninstall|uninst|isuninst|_isdel|isdel|gog|unins|config|nglide|dxsetup|directx)|uninstall/i;
export const SKIP_EXE_DIR = new Set(["__redist", "__support", "directx", "tmp"]);

/** Heuristic exe detection from extracted file paths (forward slashes). */
export function detectExeFromPaths(paths: Iterable<string>): string | undefined {
    const all = [...paths].filter((p) => p.toLowerCase().endsWith(".exe"));
    const rootExes = all.filter((p) => {
        const name = p.split("/").pop() ?? "";
        const depth = p.split("/").length - 1;
        return depth === 0 && !SKIP_EXE.test(name);
    });
    if (rootExes.length > 0) return rootExes[0];

    for (const p of all) {
        const parts = p.split("/");
        if (parts.length < 2 || parts.length > 3) continue;
        if (parts.some((seg) => SKIP_EXE_DIR.has(seg.toLowerCase()))) continue;
        const name = parts[parts.length - 1] ?? "";
        if (!SKIP_EXE.test(name)) return p;
    }
    return undefined;
}
