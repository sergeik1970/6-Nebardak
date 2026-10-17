interface ExpressSettings {
    set(setting: string, value: unknown): unknown;
}

/** Applies the already validated numeric hop count to Express 5. */
export function configureTrustedProxy(
    expressApplication: ExpressSettings,
    trustProxyHops: number,
): void {
    expressApplication.set("trust proxy", trustProxyHops);
}
