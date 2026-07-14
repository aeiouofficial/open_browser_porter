// Language-aware extraction support for multi-language GOG/Inno installers.
//
// Inno gates per-language files with a `Check:` expression. GOG's XIII (and many others)
// ships, e.g., five `system\Default.ini` entries — one per locale — each guarded by
//   check_if_install('en-US#','32#64#','')   ← English
//   check_if_install('it-IT#','32#64#','')   ← Italian
//   …
// The first argument is a `#`-separated list of locales; the rest are arch / component
// constraints we ignore here. A naive extractor that ignores Check installs ALL of them to
// the same path, so the LAST one (Italian, alphabetically/order last) wins — the bundle ends
// up in the wrong language. Filtering by the chosen locale keeps exactly one variant.

/**
 * Locales named by a file's `Check:` expression, or null if it has no language constraint
 * (no `check_if_install`, or an empty locale list). e.g. "check_if_install('es-ES#it-IT#',…)"
 * → ["es-ES","it-IT"].
 */
export function localesOfCheck(check: string | undefined | null): string[] | null {
    if (!check) return null;
    const m = /check_if_install\(\s*'([^']*)'/i.exec(check);
    if (!m) return null;
    const locales = m[1].split("#").map((s) => s.trim()).filter(Boolean);
    return locales.length ? locales : null;
}

/**
 * Whether a file guarded by `check` should be installed for `language` (a locale like
 * "en-US"). Files with no language constraint always install.
 */
export function checkAllowsLanguage(check: string | undefined | null, language: string): boolean {
    const locales = localesOfCheck(check);
    if (!locales) return true;          // no language gate → always installed
    return locales.includes(language);
}

/**
 * The distinct locales the installer offers, gathered from every file's language Check
 * (multi-locale checks contribute each locale). Sorted, e.g.
 * ["de-DE","en-US","es-ES","fr-FR","it-IT"]. Empty when the installer is single-language.
 */
export function detectInstallerLanguages(files: ReadonlyArray<{ check?: string }>): string[] {
    const set = new Set<string>();
    for (const f of files) {
        const locales = localesOfCheck(f.check);
        if (locales) for (const l of locales) set.add(l);
    }
    return [...set].sort();
}

/**
 * Pick a sensible default locale from a detected set: prefer English (en-US, then any en-*),
 * else the first sorted locale. Returns undefined for an empty set (single-language installer).
 */
export function defaultLanguage(languages: ReadonlyArray<string>): string | undefined {
    if (languages.length === 0) return undefined;
    if (languages.includes("en-US")) return "en-US";
    const en = languages.find((l) => /^en[-_]/i.test(l));
    return en ?? languages[0];
}
