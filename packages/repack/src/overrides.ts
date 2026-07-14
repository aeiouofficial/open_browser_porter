/**
 * GOG per-game emulator overrides — fetch public/gog-overrides.json (injectable for tests).
 */

import type { RegistrySeed } from "./manifest-synth";

export interface GogOverrideEntry {
    comment?: string;
    manifest?: Record<string, unknown>;
    extraRegistry?: RegistrySeed[];
}

export type GogOverridesDb = Record<string, GogOverrideEntry>;

let cachedDb: GogOverridesDb | null = null;
let fetchImpl: ((url: string) => Promise<Response>) | null = null;
let overridesUrl = "/gog-overrides.json";

export function setOverridesFetchImpl(impl: (url: string) => Promise<Response>): void {
    fetchImpl = impl;
}

export function setOverridesUrl(url: string): void {
    overridesUrl = url;
    cachedDb = null;
}

export async function loadOverrides(injected?: GogOverridesDb): Promise<GogOverridesDb> {
    if (injected) return injected;
    if (cachedDb) return cachedDb;

    try {
        const fetchFn = fetchImpl ?? fetch;
        const resp = await fetchFn(overridesUrl);
        if (!resp.ok) {
            cachedDb = {};
            return cachedDb;
        }
        cachedDb = (await resp.json()) as GogOverridesDb;
        return cachedDb;
    } catch {
        cachedDb = {};
        return cachedDb;
    }
}

export function getOverride(db: GogOverridesDb, gameId?: string): GogOverrideEntry | undefined {
    if (!gameId) return undefined;
    return db[gameId];
}
