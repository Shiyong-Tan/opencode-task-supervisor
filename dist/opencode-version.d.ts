/** Version labels identify the connected service; they are not a compatibility allowlist. */
export type OpenCodeVersion = string;
export declare function isOpenCodeVersion(value: unknown): value is OpenCodeVersion;
export declare function parseOpenCodeVersion(value: unknown): OpenCodeVersion;
