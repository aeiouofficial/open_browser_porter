/**
 * FreeArc compressor "method string" → decode parameters.
 *
 * Each FreeArc block stores its compressor as a null-terminated descriptor string, e.g.
 *   "storing"                    — stored, no compression (raw bytes)
 *   "lzma:1mb:normal:bt4:32"     — LZMA1, 1 MiB dictionary
 *
 * FreeArc's LZMA is the LZMA SDK algorithm with a RAW stream on disk: no 13-byte `.lzma`
 * container (no 5-byte props + 8-byte size). The dictionary size comes from the method
 * string; lc/lp/pb take the LZMA SDK defaults (3/0/2) unless overridden. We reconstruct
 * the 5-byte props block our LZMA1 WASM decoder expects: [propsByte, dictSize LE32].
 */

export type FreeArcMethod =
    | { kind: "store" }
    | { kind: "lzma"; dictSize: number; lc: number; lp: number; pb: number }
    | { kind: "unsupported"; raw: string };

const KIB = 1024;
const MIB = 1024 * 1024;
const GIB = 1024 * 1024 * 1024;

/** Parse a FreeArc size token like "1mb", "64k", "512kb", "1gb", or a plain byte count. */
export function parseFreeArcSize(token: string): number {
    const m = /^(\d+)\s*([kmg]?)b?$/i.exec(token.trim());
    if (!m) return NaN;
    const n = parseInt(m[1]!, 10);
    switch ((m[2] || "").toLowerCase()) {
        case "k": return n * KIB;
        case "m": return n * MIB;
        case "g": return n * GIB;
        default: return n;
    }
}

/** LZMA SDK props byte: (pb * 5 + lp) * 9 + lc. Default 3/0/2 → 0x5D. */
export function lzmaPropsByte(lc: number, lp: number, pb: number): number {
    return (pb * 5 + lp) * 9 + lc;
}

/**
 * Parse a method descriptor string. Recognizes "storing" and "lzma[:dict[:...]]"; the
 * remaining lzma sub-params (mode/match-finder/nice-len, e.g. "normal:bt4:32") do not
 * affect decoding and are ignored. lc/lp/pb default to 3/0/2 (FreeArc's LZMA default);
 * an explicit ":lcN" / ":lpN" / ":pbN" token overrides them.
 */
export function parseFreeArcMethod(method: string): FreeArcMethod {
    const s = method.trim();
    const lower = s.toLowerCase();
    if (lower === "storing" || lower === "store" || lower === "") return { kind: "store" };
    if (lower.startsWith("lzma")) {
        const parts = s.split(":");
        let dictSize = 8 * MIB; // FreeArc lzma default dictionary
        let lc = 3, lp = 0, pb = 2;
        for (let i = 1; i < parts.length; i++) {
            const tok = parts[i]!;
            const sz = parseFreeArcSize(tok);
            const lcm = /^lc(\d+)$/i.exec(tok);
            const lpm = /^lp(\d+)$/i.exec(tok);
            const pbm = /^pb(\d+)$/i.exec(tok);
            if (lcm) lc = parseInt(lcm[1]!, 10);
            else if (lpm) lp = parseInt(lpm[1]!, 10);
            else if (pbm) pb = parseInt(pbm[1]!, 10);
            else if (!Number.isNaN(sz) && i === 1) dictSize = sz; // dict is the first positional param
        }
        return { kind: "lzma", dictSize, lc, lp, pb };
    }
    return { kind: "unsupported", raw: s };
}

/** Build the 5-byte LZMA1 props block ([propsByte, dictSize LE32]) for our WASM decoder. */
export function lzmaPropsFor(m: Extract<FreeArcMethod, { kind: "lzma" }>): Uint8Array {
    const props = new Uint8Array(5);
    props[0] = lzmaPropsByte(m.lc, m.lp, m.pb);
    new DataView(props.buffer).setUint32(1, m.dictSize >>> 0, true);
    return props;
}

/**
 * A block's compressor can be a "+"-joined PIPELINE applied left-to-right at compression
 * time, e.g. "srep+lzma:200mb:…" = lzma(srep(original)). The last element is the base
 * codec (storing/lzma); the preceding ones are pre-filters (srep, delta, dict, …).
 * Decompression runs in reverse: decode the base, then undo each filter from right to left.
 */
export interface FreeArcPipeline {
    /** Filter names (lowercased, sans params) in COMPRESSION order, e.g. ["srep"]. */
    filters: string[];
    /** The base codec (last pipeline element). */
    base: FreeArcMethod;
    raw: string;
}

export function parseFreeArcPipeline(method: string): FreeArcPipeline {
    const parts = method.split("+");
    const base = parseFreeArcMethod(parts[parts.length - 1]!);
    const filters = parts.slice(0, -1).map((s) => s.split(":")[0]!.trim().toLowerCase());
    return { filters, base, raw: method };
}
