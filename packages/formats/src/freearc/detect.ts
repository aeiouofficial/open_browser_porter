/**
 * FreeArc archive detection.
 *
 * Every FreeArc archive (and each of its blocks) begins with the 4-byte signature
 * "ArC\x01" = 0x41 0x72 0x43 0x01. Repacks rename the payload to `.pak`/`.arc`/`.bin`,
 * so we recognize it by magic rather than extension.
 */

/** The 4-byte FreeArc archive/block signature, "ArC\x01". */
export const FREEARC_SIGNATURE = [0x41, 0x72, 0x43, 0x01] as const;

/** True when `data` begins with the FreeArc archive signature. */
export function detectFreeArc(data: Uint8Array): boolean {
    return (
        data.length >= 4 &&
        data[0] === FREEARC_SIGNATURE[0] &&
        data[1] === FREEARC_SIGNATURE[1] &&
        data[2] === FREEARC_SIGNATURE[2] &&
        data[3] === FREEARC_SIGNATURE[3]
    );
}
