/**
 * Container identity — the stable per-game key that owns a game's save/registry/overlay container.
 *
 * A `gameId` is a namespaced "<scheme>:<id>" (PURL/URN pattern) so provenance authorities are all
 * first-class and the storage UI knows where a game came from:
 *   - `gog:1207658691`            GOG product id (auto-emitted from the installer)
 *   - `steam:9200`                Steam appid (future)
 *   - `app:com.acclaim.revolt`    hand-authored reverse-DNS namespace
 *   - `byo:<fnvhex>`              BYO-unknown fallback (content/name-derived, stable, collision-resistant)
 *
 * The scheme is a CLOSED allowlist — an unknown scheme fails loud rather than silently minting a new
 * save dir. The id MUST survive re-download / patch / ?v=2 / region (it is the save key), so it is
 * derived from stable game identity, never from bundle bytes that change on repack.
 *
 * `gameIdToContainerDir()` is the single canonical `gameId → OPFS dir` encoder, shared by the overlay,
 * registry, and bundle cache (promoted from RegistryPersistence.normalizeGameId).
 */

/** Known provenance schemes. Closed allowlist — anything else is rejected. */
export const KNOWN_GAME_ID_SCHEMES = ["gog", "steam", "app", "byo"] as const;
export type GameIdScheme = (typeof KNOWN_GAME_ID_SCHEMES)[number];

export interface GameIdParts {
    scheme: GameIdScheme;
    /** Identifier within the scheme (e.g. "1207658691" or "com.acclaim.revolt"). */
    id: string;
}

/** Stable FNV-1a over UTF-16 code units → 8-hex-digit string. Not cryptographic; just deterministic. */
function fnv1aHex(value: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Slugify an arbitrary string into a filesystem-safe, lowercase token (used for the `app:`/`byo:`
 * id body and as the dir-encoding primitive). Collapses runs of unsafe chars to a single "-".
 */
export function slugify(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^[-.]+|[-.]+$/g, "");
}

/** Parse + validate a gameId. Returns null if malformed or the scheme is unknown. */
export function parseGameId(gameId: string): GameIdParts | null {
    const idx = gameId.indexOf(":");
    if (idx <= 0) return null;
    const scheme = gameId.slice(0, idx).toLowerCase();
    const id = gameId.slice(idx + 1).trim();
    if (!id) return null;
    if (!(KNOWN_GAME_ID_SCHEMES as readonly string[]).includes(scheme)) return null;
    return { scheme: scheme as GameIdScheme, id };
}

export function isValidGameId(gameId: string | undefined | null): gameId is string {
    return typeof gameId === "string" && parseGameId(gameId) !== null;
}

/**
 * Canonical one-way `gameId → OPFS container dir name`. Filesystem-safe + lowercase + deterministic.
 * The gameId stays the authoritative key; this dir is derived from it (never decoded back).
 */
export function gameIdToContainerDir(gameId: string): string {
    const parts = parseGameId(gameId);
    // Even for a malformed id, produce a stable dir rather than throwing here — callers that care
    // about validity check isValidGameId() first; this keeps storage robust.
    const base = parts ? `${parts.scheme}-${slugify(parts.id)}` : `x-${fnv1aHex(gameId)}`;
    return base || `x-${fnv1aHex(gameId)}`;
}

/**
 * Derive a gameId when the manifest doesn't carry one (v1 bundles, raw BYO drops).
 *   - a `name` present → `app:<slug(name)>` (authored bundle without an explicit id)
 *   - otherwise        → `byo:<fnv(entrypoint|fallback)>` (truly anonymous drop)
 */
export function deriveGameId(opts: { name?: string; entrypoint?: string }): string {
    const nameSlug = opts.name ? slugify(opts.name) : "";
    if (nameSlug) return `app:${nameSlug}`;
    const seed = opts.entrypoint || opts.name || "unknown";
    return `byo:${fnv1aHex(seed)}`;
}

/**
 * Resolve the authoritative container key for a manifest: a valid explicit `gameId` wins; otherwise
 * derive one. Logs nothing here (pure) — the load path logs the resolved id.
 */
export function resolveGameId(manifest: {
    gameId?: string;
    name?: string;
    entrypoint?: string;
}): string {
    if (isValidGameId(manifest.gameId)) return manifest.gameId;
    return deriveGameId({ name: manifest.name, entrypoint: manifest.entrypoint });
}

/** Human-friendly `.wgb` download name from manifest metadata (title slug, not the container key). */
export function manifestToWgbFilename(manifest: {
    name?: string;
    gameId?: string;
    entrypoint?: string;
}): string {
    const nameSlug = manifest.name ? slugify(manifest.name) : "";
    if (nameSlug) return `${nameSlug}.wgb`;
    return `${gameIdToContainerDir(resolveGameId(manifest))}.wgb`;
}
