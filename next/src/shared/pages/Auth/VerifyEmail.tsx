import Link from "next/link";
import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { isAuthEnabled } from "@/shared/config/runtime";
import AuthPageShell from "./AuthPageShell";
import { useOneTimeUrlToken } from "./useOneTimeUrlToken";
import styles from "./auth-page.module.scss";

type VerifyState = "checking" | "verified" | "invalid" | "missing" | "unavailable";

const VerifyEmail: React.FC = () => {
    const token = useOneTimeUrlToken();
    const { user, isLoading, verifyEmail, resendVerification } = useAuth();
    const [state, setState] = useState<VerifyState>("checking");
    const [error, setError] = useState("");
    const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");
    // A link is single-use: Strict Mode's repeated effect must not spend it twice.
    const submittedRef = useRef(false);

    useEffect(() => {
        if (!isAuthEnabled) {
            setState("unavailable");
            return;
        }
        if (token === undefined || submittedRef.current) return;
        if (token === null) {
            setState("missing");
            return;
        }

        submittedRef.current = true;
        verifyEmail(token)
            .then(() => setState("verified"))
            .catch((caught: unknown) => {
                setError(caught instanceof Error ? caught.message : "");
                setState("invalid");
            });
    }, [token, verifyEmail]);

    const handleResend = async () => {
        setResendState("sending");
        setError("");
        try {
            await resendVerification();
            setResendState("sent");
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Не удалось отправить письмо");
            setResendState("idle");
        }
    };

    const canResend = !isLoading && user && !user.emailVerified;

    return (
        <AuthPageShell title="Подтверждение почты" eyebrow="Аккаунт" heading="Подтверждение почты">
            <div aria-live="polite">
                {state === "checking" ? <p className={styles.text}>Проверяем ссылку…</p> : null}
                {state === "verified" ? (
                    <p className={`${styles.status} ${styles.success}`}>
                        Почта подтверждена. Проекты надёжно привязаны к аккаунту, а пароль можно
                        восстановить по почте.
                    </p>
                ) : null}
                {state === "invalid" || state === "missing" ? (
                    <p className={`${styles.status} ${styles.error}`} role="alert">
                        {state === "missing"
                            ? "В ссылке нет кода подтверждения. Откройте ссылку из письма целиком."
                            : error || "Ссылка недействительна или устарела."}
                    </p>
                ) : null}
                {state === "unavailable" ? (
                    <p className={styles.text}>Аккаунты сейчас отключены.</p>
                ) : null}
                {resendState === "sent" ? (
                    <p className={`${styles.status} ${styles.success}`}>
                        Новое письмо отправлено на {user?.email}.
                    </p>
                ) : null}
            </div>

            <div className={styles.actions}>
                <Link className={styles.primary} href="/planner">
                    Перейти к планировщику
                </Link>
                {(state === "invalid" || state === "missing") && canResend ? (
                    <button
                        className={styles.secondary}
                        disabled={resendState !== "idle"}
                        onClick={handleResend}
                        type="button"
                    >
                        {resendState === "sending" ? "Отправляем…" : "Отправить письмо ещё раз"}
                    </button>
                ) : null}
            </div>
            {(state === "invalid" || state === "missing") && !isLoading && !user ? (
                <p className={`${styles.hint} ${styles.followUp}`}>
                    Чтобы получить новое письмо, войдите в аккаунт.
                </p>
            ) : null}
        </AuthPageShell>
    );
};

export default VerifyEmail;
