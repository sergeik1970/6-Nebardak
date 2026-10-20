import React, { ReactNode, useEffect, useRef } from "react";
import type { SyncState } from "@/shared/lib/project-sync/ProjectSync";
import styles from "./index.module.scss";

type Tone = "ok" | "busy" | "warn" | "error";

interface Action {
    label: string;
    onClick: () => void;
    disabled?: boolean;
}

interface ProjectBarProps {
    title: ReactNode;
    status: string;
    tone: Tone;
    action?: Action;
}

/**
 * The thin line above a project page: which project is open and whether it is
 * saved. Its height is published as `--sf-project-bar-height` so full-screen
 * pages (the room editor) can subtract it instead of overflowing.
 */
const ProjectBar: React.FC<ProjectBarProps> = ({ title, status, tone, action }) => {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const element = ref.current;
        const root = document.documentElement;
        if (!element) return;
        const publish = () =>
            root.style.setProperty("--sf-project-bar-height", `${element.offsetHeight}px`);
        publish();
        const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish);
        observer?.observe(element);
        return () => {
            observer?.disconnect();
            root.style.removeProperty("--sf-project-bar-height");
        };
    }, []);

    return (
        <div className={styles.bar} data-project-bar="true" ref={ref}>
            <span className={styles.title}>{title}</span>
            <span className={styles.status} data-tone={tone} role="status" aria-live="polite">
                {status}
            </span>
            {action ? (
                <button
                    className={styles.action}
                    disabled={action.disabled}
                    onClick={action.onClick}
                    type="button"
                >
                    {action.label}
                </button>
            ) : null}
        </div>
    );
};

export default ProjectBar;

const formatTime = (timestamp: number) =>
    new Date(timestamp).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

/** Russian wording and tone for each sync state. */
export const describeSyncState = (state: SyncState): { status: string; tone: Tone } => {
    if (state.updatedElsewhere && state.status !== "conflict") {
        return { status: "Проект изменён в другой вкладке", tone: "warn" };
    }
    switch (state.status) {
        case "loading":
            return { status: "Загружаем проект…", tone: "busy" };
        case "saved":
            return {
                status: state.lastSavedAt
                    ? `Сохранено в ${formatTime(state.lastSavedAt)}`
                    : "Сохранено",
                tone: "ok",
            };
        case "pending":
            return { status: "Есть несохранённые изменения", tone: "busy" };
        case "saving":
            return { status: "Сохраняем…", tone: "busy" };
        case "offline":
            return { status: state.message ?? "Нет сети", tone: "warn" };
        case "auth":
            return { status: state.message ?? "Нужно войти снова", tone: "warn" };
        case "conflict":
            return { status: "Конфликт версий", tone: "error" };
        case "not-found":
            return { status: state.message ?? "Проект не найден", tone: "error" };
        default:
            return { status: state.message ?? "Не удалось сохранить", tone: "error" };
    }
};
