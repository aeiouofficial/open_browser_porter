/**
 * GOG Galaxy install scripts (goggame-<id>.script) carry post-install registry
 * writes that Inno's [Registry] section does not include — e.g. LucasArts game keys.
 */

import type { RegistrySeed } from "./manifest-synth";

const ROOT_MAP: Record<string, string> = {
    HKEY_LOCAL_MACHINE: "HKLM",
    HKLM: "HKLM",
    HKEY_CURRENT_USER: "HKCU",
    HKCU: "HKCU",
    HKEY_CLASSES_ROOT: "HKCR",
    HKCR: "HKCR",
    HKEY_USERS: "HKU",
    HKU: "HKU",
};

function resolveAppPath(value: string, installRoot = "C:\\"): string {
    const normalized = value.replace(/\//g, "\\");
    if (/^\{app\}$/i.test(normalized)) {
        return installRoot.endsWith("\\") ? installRoot : `${installRoot}\\`;
    }
    const root = installRoot.replace(/\\$/, "");
    return normalized.replace(/\{app\}/gi, root);
}

function actionApplies(languages: unknown): boolean {
    if (!Array.isArray(languages) || languages.length === 0) return true;
    return languages.some((l) => l === "*" || l === "neutral");
}

function mapValueType(valueType: unknown): "REG_SZ" | "REG_DWORD" | null {
    const t = String(valueType ?? "string").toLowerCase();
    if (t === "dword" || t === "integer") return "REG_DWORD";
    if (t === "string" || t === "expandablestring" || t === "binary") return "REG_SZ";
    return null;
}

function parseScriptRegistryAction(
    args: Record<string, unknown>,
    installRoot: string,
): { root: string; path: string; name: string; type: "REG_SZ" | "REG_DWORD"; data: string | number } | null {
    if (args.deleteSubkeys) return null;
    const valueName = args.valueName;
    if (typeof valueName !== "string" || !valueName) return null;

    const rootRaw = String(args.root ?? "HKEY_LOCAL_MACHINE");
    const root = ROOT_MAP[rootRaw.toUpperCase()] ?? ROOT_MAP[rootRaw] ?? "HKLM";
    const subkey = String(args.subkey ?? "").replace(/\//g, "\\");
    if (!subkey || subkey.includes("{")) return null;

    const regType = mapValueType(args.valueType);
    if (!regType) return null;

    let rawData = String(args.valueData ?? "");
    if (regType === "REG_DWORD") {
        const n = parseInt(rawData, 10);
        if (!Number.isFinite(n)) return null;
        return { root, path: subkey, name: valueName, type: regType, data: n >>> 0 };
    }

    rawData = resolveAppPath(rawData, installRoot);
    if (rawData.includes("{")) return null;
    return { root, path: subkey, name: valueName, type: regType, data: rawData };
}

/** Parse one goggame-*.script JSON blob into registry seeds. */
export function parseGogScriptRegistry(
    scriptBytes: Uint8Array,
    installRoot = "C:\\",
): RegistrySeed[] {
    let parsed: { actions?: unknown[] };
    try {
        parsed = JSON.parse(new TextDecoder().decode(scriptBytes)) as { actions?: unknown[] };
    } catch {
        return [];
    }

    const byKey = new Map<string, RegistrySeed>();
    for (const item of parsed.actions ?? []) {
        if (!item || typeof item !== "object") continue;
        const row = item as { install?: { action?: string; arguments?: Record<string, unknown> }; languages?: unknown };
        if (!actionApplies(row.languages)) continue;
        const install = row.install;
        if (!install || install.action !== "setRegistry") continue;
        const args = install.arguments;
        if (!args || typeof args !== "object") continue;

        const entry = parseScriptRegistryAction(args, installRoot);
        if (!entry) continue;

        const seedKey = `${entry.root}\\${entry.path}`;
        let seed = byKey.get(seedKey);
        if (!seed) {
            seed = { root: entry.root, path: entry.path, values: [] };
            byKey.set(seedKey, seed);
        }
        const idx = seed.values.findIndex((v) => v.name.toLowerCase() === entry.name.toLowerCase());
        const value = { name: entry.name, type: entry.type, data: entry.data };
        if (idx >= 0) seed.values[idx] = value;
        else seed.values.push(value);
    }

    return [...byKey.values()];
}

/** Collect setRegistry seeds from all goggame-*.script files in an extracted map. */
export function synthesizeRegistryFromGogScripts(
    gameFiles: Map<string, Uint8Array>,
    installRoot = "C:\\",
): RegistrySeed[] {
    const byKey = new Map<string, RegistrySeed>();

    for (const [path, data] of gameFiles) {
        const base = path.split("/").pop() ?? "";
        if (!/^goggame-.*\.script$/i.test(base)) continue;
        for (const seed of parseGogScriptRegistry(data, installRoot)) {
            const seedKey = `${seed.root}\\${seed.path}`;
            const existing = byKey.get(seedKey);
            if (!existing) {
                byKey.set(seedKey, { ...seed, values: [...seed.values] });
                continue;
            }
            for (const v of seed.values) {
                const idx = existing.values.findIndex((e) => e.name.toLowerCase() === v.name.toLowerCase());
                if (idx >= 0) existing.values[idx] = v;
                else existing.values.push(v);
            }
        }
    }

    return [...byKey.values()];
}

/** Merge registry seeds; later entries override same hive/path/value name. */
export function mergeRegistrySeeds(
    base: RegistrySeed | RegistrySeed[],
    extra: RegistrySeed[],
): RegistrySeed[] {
    const map = new Map<string, RegistrySeed>();

    const add = (seed: RegistrySeed) => {
        const key = `${seed.root}\\${seed.path}`;
        const existing = map.get(key);
        if (!existing) {
            map.set(key, { root: seed.root, path: seed.path, values: [...seed.values] });
            return;
        }
        for (const v of seed.values) {
            const idx = existing.values.findIndex((e) => e.name.toLowerCase() === v.name.toLowerCase());
            if (idx >= 0) existing.values[idx] = v;
            else existing.values.push(v);
        }
    };

    const list = Array.isArray(base) ? base : [base];
    for (const s of list) add(s);
    for (const s of extra) add(s);
    return [...map.values()];
}
