export function formatDuration(ms) {
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 1) return `${Math.max(0, Math.round(ms / 1000))} с`;
    if (minutes < 60) return `${minutes} мин`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ч ${minutes % 60} мин`;
    return `${Math.floor(hours / 24)} д ${hours % 24} ч`;
}

// Second precision for recent events: "4 мин 05 с".
export function formatAge(ms) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    if (seconds >= 3600) return formatDuration(ms);
    const minutes = Math.floor(seconds / 60);
    if (minutes === 0) return `${seconds} с`;
    return `${minutes} мин ${String(seconds % 60).padStart(2, "0")} с`;
}

export function formatClock(ms, timeZone) {
    return new Date(ms).toLocaleTimeString("ru-RU", { timeZone, hour12: false });
}

export function formatDay(ms, timeZone) {
    return new Date(ms).toLocaleDateString("ru-RU", { timeZone, day: "2-digit", month: "2-digit" });
}

export function formatTime(ms, timeZone) {
    return new Date(ms).toLocaleString("ru-RU", {
        timeZone,
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}
