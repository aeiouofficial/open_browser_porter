/**
 * Directory path casing propagation — ported from innoextract cli/extract.cpp insert_dirs (477-531).
 * When the same directory appears with different casing, the first registered spelling wins and
 * later file paths are rewritten to match (Windows semantics).
 */

function parentDir(path: string): string {
    const pos = path.lastIndexOf("/");
    return pos === -1 ? "" : path.slice(0, pos);
}

export class DirectoryCasingRegistry {
    private readonly dirs = new Map<string, string>();

    /** Rewrite `path` so each directory component matches previously seen casing. */
    fixPath(path: string): string {
        const holder = { value: path };
        this.insertDirs(path.toLowerCase(), holder, true);
        return holder.value;
    }

    private insertDirs(internalPath: string, path: { value: string }, implied: boolean): boolean {
        const dir = parentDir(path.value);
        const internalDir = parentDir(internalPath);
        if (!internalDir) return false;

        if (implied) {
            const existing = this.dirs.get(internalDir);
            if (existing !== undefined) {
                if (existing !== dir) {
                    path.value = existing + path.value.slice(dir.length);
                    return true;
                }
                return false;
            }
            this.dirs.set(internalDir, dir);
            implied = true;
        }

        const oldLength = dir.length;
        const dirHolder = { value: dir };
        if (this.insertDirs(internalDir, dirHolder, true)) {
            const fixedDir = dirHolder.value;
            if (fixedDir.length === oldLength) {
                path.value = fixedDir + path.value.slice(oldLength);
            } else {
                path.value = fixedDir + path.value.slice(oldLength);
            }
            this.dirs.set(internalDir, fixedDir);
            return true;
        }

        return false;
    }
}
