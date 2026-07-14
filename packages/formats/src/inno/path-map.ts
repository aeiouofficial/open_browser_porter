/**
 * Windows-style path map: keys fold case-insensitively, first-seen casing is preserved.
 */

export class CaseInsensitivePathMap {
    private readonly canonical = new Map<string, string>();
    private readonly files = new Map<string, Uint8Array>();

    set(path: string, data: Uint8Array): void {
        const lower = path.toLowerCase();
        let canon = this.canonical.get(lower);
        if (!canon) {
            canon = path;
            this.canonical.set(lower, canon);
        }
        this.files.set(canon, data);
    }

    get(path: string): Uint8Array | undefined {
        const canon = this.canonical.get(path.toLowerCase());
        return canon ? this.files.get(canon) : undefined;
    }

    has(path: string): boolean {
        return this.canonical.has(path.toLowerCase());
    }

    get size(): number {
        return this.files.size;
    }

    keys(): IterableIterator<string> {
        return this.files.keys();
    }

    entries(): IterableIterator<[string, Uint8Array]> {
        return this.files.entries();
    }

    [Symbol.iterator](): IterableIterator<[string, Uint8Array]> {
        return this.entries();
    }

    toMap(): Map<string, Uint8Array> {
        return new Map(this.files);
    }
}
