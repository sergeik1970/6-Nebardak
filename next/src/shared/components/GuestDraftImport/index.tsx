import Link from "next/link";
import { useRouter } from "next/router";
import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { projectsService } from "@/services/projectsService";
import Dialog from "@/shared/components/Dialog";
import {
    discardGuestDraft,
    importGuestDraft,
    readGuestDocument,
} from "@/shared/lib/project-sync/guest-import";
import { withProjectParam } from "@/shared/lib/project-scope/storage";

const FLOW_PAGES = new Set([
    "/test",
    "/questionnaire",
    "/planner",
    "/planner/draw",
    "/planner/layout",
]);

type Prompt =
    | { kind: "ask" }
    | { kind: "saving" }
    | { kind: "saved"; projectId: string; name: string }
    | { kind: "error"; message: string };

/**
 * Right after signing in, offers to move the browser-only draft into the
 * account. A brand-new account takes it automatically: that is the work the
 * person just registered to keep.
 */
const GuestDraftImport: React.FC = () => {
    const router = useRouter();
    const { lastAuthEvent } = useAuth();
    const [prompt, setPrompt] = useState<Prompt | null>(null);
    const handledEventRef = useRef<number | null>(null);

    const isGuestFlowPage =
        FLOW_PAGES.has(router.pathname) && typeof router.query.project !== "string";

    const runImport = async () => {
        setPrompt({ kind: "saving" });
        try {
            const project = await importGuestDraft(projectsService);
            if (!project) {
                setPrompt(null);
                return;
            }
            if (isGuestFlowPage) {
                // Continue right here, now inside the saved project.
                setPrompt(null);
                await router.replace(withProjectParam(router.asPath, project.id));
            } else {
                setPrompt({ kind: "saved", projectId: project.id, name: project.name });
            }
        } catch (caught) {
            setPrompt({
                kind: "error",
                message: caught instanceof Error ? caught.message : "Не удалось сохранить черновик",
            });
        }
    };

    useEffect(() => {
        if (!lastAuthEvent || handledEventRef.current === lastAuthEvent.at) return;
        handledEventRef.current = lastAuthEvent.at;
        if (!readGuestDocument()) return;

        if (lastAuthEvent.kind === "register") void runImport();
        else setPrompt({ kind: "ask" });
        // `runImport` reads the current route at call time; the event is the trigger.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lastAuthEvent]);

    if (!prompt) return null;

    if (prompt.kind === "saved") {
        return (
            <Dialog
                open
                title="Черновик сохранён в аккаунт"
                onCancel={() => setPrompt(null)}
                actions={
                    <>
                        <Link
                            data-variant="primary"
                            href={withProjectParam("/planner", prompt.projectId)}
                            onClick={() => setPrompt(null)}
                        >
                            Открыть проект
                        </Link>
                        <button onClick={() => setPrompt(null)} type="button">
                            Закрыть
                        </button>
                    </>
                }
            >
                <p>
                    Проект «{prompt.name}» теперь хранится в аккаунте и доступен на любом
                    устройстве.
                </p>
            </Dialog>
        );
    }

    return (
        <Dialog
            open
            title="Сохранить черновик в аккаунт?"
            onCancel={() => setPrompt(null)}
            actions={
                <>
                    <button
                        data-variant="primary"
                        disabled={prompt.kind === "saving"}
                        onClick={() => void runImport()}
                        type="button"
                    >
                        {prompt.kind === "saving" ? "Сохраняем…" : "Сохранить как новый проект"}
                    </button>
                    <button
                        disabled={prompt.kind === "saving"}
                        onClick={() => {
                            discardGuestDraft();
                            setPrompt(null);
                            if (isGuestFlowPage) window.location.reload();
                        }}
                        type="button"
                    >
                        Удалить черновик
                    </button>
                    <button
                        disabled={prompt.kind === "saving"}
                        onClick={() => setPrompt(null)}
                        type="button"
                    >
                        Позже
                    </button>
                </>
            }
        >
            <p>
                В этом браузере есть черновик, сделанный без входа. Его можно сохранить в аккаунт,
                чтобы он не потерялся и открывался на других устройствах.
            </p>
            {prompt.kind === "error" ? <p role="alert">{prompt.message}</p> : null}
        </Dialog>
    );
};

export default GuestDraftImport;
