/**
 * CUE sheet parsing — just enough to locate the data track of a game CD.
 *
 * A .cue references one or more BIN files and the tracks they contain:
 *
 *   FILE "game.bin" BINARY
 *     TRACK 01 MODE1/2352
 *       INDEX 01 00:00:00
 *     TRACK 02 AUDIO
 *       INDEX 00 55:58:00
 *       INDEX 01 55:60:00
 *
 * For ISO9660 extraction we only need the first *data* track: which BIN file it
 * lives in, the byte offset where the track starts within that file, and the raw
 * sector framing implied by its mode. Audio tracks are ignored.
 */

import {
    type SectorLayout,
    LAYOUT_ISO,
    LAYOUT_MODE1_2352,
    LAYOUT_MODE2_2352,
    LAYOUT_MODE2_2336,
} from "./sector-source";

export interface CueTrack {
    number: number;
    /** Raw mode string, e.g. "MODE1/2352", "MODE2/2352", "AUDIO". */
    mode: string;
    /** True for any MODE1/MODE2 track (i.e. carries a filesystem, not audio). */
    isData: boolean;
    /** BIN file this track lives in (as written in the cue, basename-normalized). */
    file: string;
    /** Sector layout implied by the mode, or null for audio. */
    layout: SectorLayout | null;
    /** Byte offset within `file` where the track's INDEX 01 begins. */
    byteOffsetInFile: number;
}

export interface CueSheet {
    /** Distinct BIN files referenced, in declaration order. */
    files: string[];
    tracks: CueTrack[];
    /** The first data track, or undefined for a pure-audio sheet. */
    dataTrack?: CueTrack;
}

function layoutForMode(mode: string): SectorLayout | null {
    switch (mode.toUpperCase()) {
        case "MODE1/2048": return LAYOUT_ISO;
        case "MODE1/2352": return LAYOUT_MODE1_2352;
        case "MODE2/2352": return LAYOUT_MODE2_2352;
        case "MODE2/2336": return LAYOUT_MODE2_2336;
        default: return null; // AUDIO, CDG, unsupported
    }
}

/** Convert an MSF timestamp (mm:ss:ff, 75 frames/sec) to a logical frame count. */
function msfToFrames(msf: string): number {
    const m = msf.match(/(\d+):(\d+):(\d+)/);
    if (!m) return 0;
    return (parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10)) * 75 + parseInt(m[3]!, 10);
}

/** Take the basename of a cue FILE path (cue paths are relative to the cue dir). */
function cueBasename(p: string): string {
    return p.replace(/\\/g, "/").split("/").pop() ?? p;
}

/**
 * Parse cue text. `byteOffsetInFile` is computed from INDEX 01 against the
 * track's own sector size, which is correct for the common single-FILE layout
 * where INDEX times are file-relative.
 */
export function parseCue(text: string): CueSheet {
    const files: string[] = [];
    const tracks: CueTrack[] = [];

    let currentFile = "";
    let pending: { number: number; mode: string } | null = null;

    const flushPending = (indexFrames: number) => {
        if (!pending) return;
        const layout = layoutForMode(pending.mode);
        const sectorSize = layout?.rawSectorSize ?? 2352;
        tracks.push({
            number: pending.number,
            mode: pending.mode,
            isData: /MODE[12]/i.test(pending.mode),
            file: currentFile,
            layout,
            byteOffsetInFile: indexFrames * sectorSize,
        });
        pending = null;
    };

    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;

        const fileMatch = line.match(/^FILE\s+"?(.+?)"?\s+(BINARY|MOTOROLA|WAVE|MP3|AIFF)\s*$/i);
        if (fileMatch) {
            flushPending(0);
            currentFile = cueBasename(fileMatch[1]!);
            if (!files.includes(currentFile)) files.push(currentFile);
            continue;
        }

        const trackMatch = line.match(/^TRACK\s+(\d+)\s+(\S+)/i);
        if (trackMatch) {
            // A track with no INDEX yet defaults to offset 0 in its file.
            flushPending(0);
            pending = { number: parseInt(trackMatch[1]!, 10), mode: trackMatch[2]! };
            continue;
        }

        const indexMatch = line.match(/^INDEX\s+(\d+)\s+(\d+:\d+:\d+)/i);
        if (indexMatch && pending) {
            // INDEX 01 is the track's true start; ignore INDEX 00 (pregap).
            if (parseInt(indexMatch[1]!, 10) === 1) {
                flushPending(msfToFrames(indexMatch[2]!));
            }
            continue;
        }
    }
    flushPending(0);

    const dataTrack = tracks.find((t) => t.isData && t.layout !== null);
    return { files, tracks, dataTrack };
}
