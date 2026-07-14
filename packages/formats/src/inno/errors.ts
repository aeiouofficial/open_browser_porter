/** Inno Setup format errors with stream context. */

export class InnoFormatError extends Error {
    readonly name = "InnoFormatError";

    constructor(
        message: string,
        readonly offset?: number,
        readonly chunk?: string,
    ) {
        const parts: string[] = [message];
        if (offset !== undefined) parts.push(`offset=0x${offset.toString(16)}`);
        if (chunk !== undefined) parts.push(`chunk=${chunk}`);
        super(parts.join(" — "));
    }
}
