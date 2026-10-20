import React, { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import styles from "./index.module.scss";

/** Shown to signed-in users until they open the link from the welcome letter. */
const EmailVerificationBanner: React.FC = () => {
    const { user, resendVerification } = useAuth();
    const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
    const [message, setMessage] = useState("");

    if (!user || user.emailVerified) return null;

    const handleResend = async () => {
        setState("sending");
        try {
            await resendVerification();
            setState("sent");
        } catch (caught) {
            setMessage(caught instanceof Error ? caught.message : "Не удалось отправить письмо");
            setState("failed");
        }
    };

    return (
        <div className={styles.banner} role="region" aria-label="Напоминание о подтверждении почты">
            <p className={styles.text} aria-live="polite">
                {state === "sent" ? (
                    <>Письмо отправлено ещё раз на {user.email}.</>
                ) : state === "failed" ? (
                    message
                ) : (
                    <>
                        Подтвердите почту: мы отправили ссылку на <strong>{user.email}</strong>.
                        Неподтверждённый аккаунт, которым не пользуются 30 дней, удаляется.
                    </>
                )}
            </p>
            {state !== "sent" ? (
                <button
                    className={styles.action}
                    disabled={state === "sending"}
                    onClick={handleResend}
                    type="button"
                >
                    {state === "sending" ? "Отправляем…" : "Отправить ещё раз"}
                </button>
            ) : null}
        </div>
    );
};

export default EmailVerificationBanner;
