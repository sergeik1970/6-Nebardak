const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Plain Bot API over fetch. Errors never include the URL, which carries the token.
export class Telegram {
    constructor(token) {
        this.base = `https://api.telegram.org/bot${token}`;
    }

    async call(method, body, timeoutMs = 15_000) {
        const response = await fetch(`${this.base}/${method}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
        });
        const data = await response.json();
        if (!data.ok) throw new Error(`Telegram ${method}: ${data.error_code} ${data.description}`);
        return data.result;
    }

    send(chatId, text) {
        return this.call("sendMessage", {
            chat_id: chatId,
            text,
            link_preview_options: { is_disabled: true },
        });
    }

    async *messages() {
        let offset;
        for (;;) {
            try {
                const updates = await this.call(
                    "getUpdates",
                    { offset, timeout: 50, allowed_updates: ["message"] },
                    60_000,
                );
                for (const update of updates) {
                    offset = update.update_id + 1;
                    if (update.message) yield update.message;
                }
            } catch (error) {
                console.error(`getUpdates failed: ${error.message}`);
                await sleep(5_000);
            }
        }
    }
}

// Keeps messages that Telegram did not accept and resends them in order later.
export class Outbox {
    constructor(send, limit = 50) {
        this.send = send;
        this.limit = limit;
        this.queue = [];
        this.flushing = false;
    }

    push(text) {
        if (!text) return;
        this.queue.push(text);
        if (this.queue.length > this.limit) this.queue.splice(0, this.queue.length - this.limit);
        return this.flush();
    }

    async flush() {
        if (this.flushing) return;
        this.flushing = true;
        try {
            while (this.queue.length > 0) {
                await this.send(this.queue[0]);
                this.queue.shift();
            }
        } catch (error) {
            console.error(`sendMessage failed, ${this.queue.length} queued: ${error.message}`);
        } finally {
            this.flushing = false;
        }
    }
}
