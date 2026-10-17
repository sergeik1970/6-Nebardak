export const isValidRightsEvidence = (value) => {
    if (typeof value !== "string") return false;

    if (/^record:[A-Za-z0-9][A-Za-z0-9._/-]{7,}$/.test(value)) return true;

    try {
        const url = new URL(value);
        const identifiesRecord = `${url.pathname}${url.search}${url.hash}` !== "/";
        return url.protocol === "https:" && Boolean(url.hostname) && identifiesRecord;
    } catch {
        return false;
    }
};
