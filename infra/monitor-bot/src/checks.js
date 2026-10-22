import tls from "node:tls";

export function describeError(error, timeoutMs) {
    if (error?.name === "TimeoutError") return `нет ответа за ${Math.round(timeoutMs / 1000)} с`;
    const code = error?.cause?.code ?? error?.code;
    return code ? String(code) : String(error?.message ?? error);
}

export async function checkHttp(target, timeoutMs, fetchImpl = fetch) {
    const started = performance.now();
    try {
        const response = await fetchImpl(target.url, {
            headers: { "user-agent": "stylefinder-monitor" },
            signal: AbortSignal.timeout(timeoutMs),
        });
        const ms = Math.round(performance.now() - started);
        const expected = target.status ?? 200;
        const body = await response.text();
        if (response.status !== expected) {
            return { ok: false, detail: `HTTP ${response.status}, ожидался ${expected}` };
        }
        if (target.contains && !body.includes(target.contains)) {
            return { ok: false, detail: `в ответе нет «${target.contains}»` };
        }
        return { ok: true, detail: `HTTP ${response.status}, ${ms} мс` };
    } catch (error) {
        return { ok: false, detail: describeError(error, timeoutMs) };
    }
}

export function certificateExpiry(host, timeoutMs) {
    return new Promise((resolve, reject) => {
        const socket = tls.connect({ host, port: 443, servername: host }, () => {
            const { valid_to: validTo } = socket.getPeerCertificate();
            socket.end();
            resolve(new Date(validTo));
        });
        socket.setTimeout(timeoutMs, () => {
            socket.destroy(Object.assign(new Error("timeout"), { name: "TimeoutError" }));
        });
        socket.on("error", reject);
    });
}

export async function checkTls(host, warnDays, timeoutMs, now = Date.now()) {
    try {
        const expires = await certificateExpiry(host, timeoutMs);
        const days = Math.floor((expires.getTime() - now) / 86_400_000);
        return {
            ok: days >= warnDays,
            detail: `сертификат истекает через ${days} дн.`,
        };
    } catch (error) {
        return { ok: false, detail: `TLS: ${describeError(error, timeoutMs)}` };
    }
}
