import fs from "node:fs";
import path from "node:path";

const KEEP_DAYS = 400;
const empty = () => ({
    requests: 0,
    failed: 0,
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
    unpriced: 0,
});

/**
 * Requests, tokens and dollars per UTC day, kept in a JSON file so a restart
 * does not lose them. Without a file it only counts in memory.
 */
export class UsageBook {
    constructor(file = null) {
        this.file = file;
        this.days = {};
        if (file && fs.existsSync(file)) {
            try {
                this.days = JSON.parse(fs.readFileSync(file, "utf8")).days ?? {};
            } catch {
                this.days = {};
            }
        }
    }

    day(date) {
        this.days[date] ??= empty();
        return this.days[date];
    }

    /** `usage` is null for a failed request. `cost` is null when unknown. */
    record(date, usage, cost) {
        const entry = this.day(date);
        entry.requests += 1;
        if (!usage) entry.failed += 1;
        else {
            entry.inputTokens += usage.inputTokens;
            entry.outputTokens += usage.outputTokens;
            if (cost === null) entry.unpriced += 1;
            else entry.cost = Math.round((entry.cost + cost) * 1e6) / 1e6;
        }
        const dates = Object.keys(this.days).sort();
        for (const old of dates.slice(0, Math.max(0, dates.length - KEEP_DAYS)))
            delete this.days[old];
        this.save();
    }

    save() {
        if (!this.file) return;
        try {
            const temporary = `${this.file}.tmp`;
            fs.mkdirSync(path.dirname(this.file), { recursive: true });
            fs.writeFileSync(temporary, JSON.stringify({ days: this.days }));
            fs.renameSync(temporary, this.file);
        } catch (error) {
            console.error(`usage not saved: ${error.message}`);
        }
    }

    /** `month` is "YYYY-MM". */
    summary(month) {
        const total = empty();
        const thisMonth = empty();
        for (const [date, entry] of Object.entries(this.days)) {
            for (const target of date.startsWith(month) ? [total, thisMonth] : [total])
                for (const key of Object.keys(target)) target[key] += entry[key];
        }
        for (const target of [total, thisMonth]) target.cost = Math.round(target.cost * 1e6) / 1e6;
        return { days: this.days, month: thisMonth, total };
    }
}
