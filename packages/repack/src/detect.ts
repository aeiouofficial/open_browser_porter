/**

 * Blob format detection.

 *

 * Cheap head sniff (PK / MZ) is done in the worker before reading the full blob.

 * MZ executables may embed Inno setup.0 at the end of the file; detection requires

 * the complete buffer (offsets table is not reachable from the first 64 KiB).

 */



import {

    BufferSource,

    InnoFormatError,

    loadOffsets,

    readVersionAt,

    assertSupportedVersion,

} from "@obp/formats/inno";



export type DetectedFormat = "wgb" | "inno" | "inno-unsupported" | "pe" | "unknown";



/** First-bytes classification — safe on a tiny slice (e.g. 64 B). */

export type BlobHeadKind = "wgb" | "mz" | "unknown";



export function sniffBlobHead(head: Uint8Array): BlobHeadKind {

    if (head.byteLength >= 4 &&

        head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {

        return "wgb";

    }

    if (head.byteLength >= 2 && head[0] === 0x4d && head[1] === 0x5a) {

        return "mz";

    }

    return "unknown";

}



/** Full-buffer detection for MZ (and already-materialized) payloads. Never throws. */

export function detectFormat(data: Uint8Array): DetectedFormat {

    if (data.byteLength >= 4 &&

        data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04) {

        return "wgb";

    }



    if (data.byteLength < 2 || data[0] !== 0x4d || data[1] !== 0x5a) {

        return "unknown";

    }



    try {

        const source = new BufferSource(data);

        const offsets = loadOffsets(source);

        if (!offsets.foundMagic || !offsets.headerOffset) {

            return "pe";

        }



        const versionBytes = source.readRangeSync(offsets.headerOffset, offsets.headerOffset + 64);

        const version = readVersionAt(versionBytes, offsets.headerOffset);

        assertSupportedVersion(version, offsets.headerOffset);

        return "inno";

    } catch (e) {

        if (e instanceof InnoFormatError && e.message.includes("unsupported Inno Setup version")) {

            return "inno-unsupported";

        }

        return "pe";

    }

}


