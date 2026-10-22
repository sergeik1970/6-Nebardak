export function formatDuration(ms) {
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 1) return `${Math.max(0, Math.round(ms / 1000))} с`;
    if (minutes < 60) return `${minutes} мин`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ч ${minutes % 60} мин`;
    return `${Math.floor(hours / 24)} д ${hours % 24} ч`;
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
