import Link from "next/link";
import React, { useEffect, useId, useRef, useState } from "react";
import { useAuth } from "../../../contexts/AuthContext";
import { isAuthRegistrationEnabled } from "@/shared/config/runtime";
import InputText from "../InputText";
import Checkbox from "../Checkbox";
import { CURRENT_CONSENT_VERSION } from "@/shared/legal/consent";
import { ApiError } from "@/services/apiClient";
import { type SecondFactorChallenge } from "@/types/auth";
import styles from "./index.module.scss";

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
    registrationEnabled?: boolean;
}

const focusableSelector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
].join(",");

const AuthModal: React.FC<AuthModalProps> = ({
    isOpen,
    onClose,
    registrationEnabled = isAuthRegistrationEnabled,
}) => {
    const [isLogin, setIsLogin] = useState(true);
    const [formData, setFormData] = useState({ name: "", email: "", password: "" });
    const [hasConsent, setHasConsent] = useState(false);
    const [error, setError] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    // Set once an administrator's password is accepted; the dialog then asks for the code.
    const [pendingCode, setPendingCode] = useState<SecondFactorChallenge | null>(null);
    const [code, setCode] = useState("");
    const [notice, setNotice] = useState("");
    const codeRef = useRef<HTMLInputElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    const emailRef = useRef<HTMLInputElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);
    const titleId = useId();
    const descriptionId = useId();
    const errorId = useId();
    const nameId = useId();
    const emailId = useId();
    const passwordId = useId();
    const codeId = useId();
    const codeHintId = useId();

    const { login, confirmLoginCode, register } = useAuth();

    useEffect(() => {
        if (!registrationEnabled && !isLogin) setIsLogin(true);
    }, [isLogin, registrationEnabled]);

    // A closed dialog forgets a half-finished sign-in and the typed password.
    useEffect(() => {
        if (isOpen) return;
        setPendingCode(null);
        setCode("");
        setNotice("");
        setFormData({ name: "", email: "", password: "" });
    }, [isOpen]);

    useEffect(() => {
        if (pendingCode) codeRef.current?.focus();
    }, [pendingCode]);

    useEffect(() => {
        if (!isOpen) return;

        previousFocusRef.current = document.activeElement as HTMLElement | null;
        const oldOverflow = document.body.style.overflow;
        const oldPaddingRight = document.body.style.paddingRight;
        const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
        document.body.style.overflow = "hidden";
        if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;

        const backgroundElements = Array.from(
            document.querySelectorAll<HTMLElement>('main, footer, [data-auth-background="true"]'),
        );
        const backgroundState = backgroundElements.map((element) => ({
            element,
            ariaHidden: element.getAttribute("aria-hidden"),
            inert: element.inert,
        }));
        backgroundElements.forEach((element) => {
            element.inert = true;
            element.setAttribute("aria-hidden", "true");
        });

        const focusTimer = window.requestAnimationFrame(() => emailRef.current?.focus());
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                onClose();
                return;
            }
            if (event.key !== "Tab" || !dialogRef.current) return;

            const focusable = Array.from(
                dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector),
            ).filter((element) => !element.hasAttribute("disabled"));
            if (focusable.length === 0) {
                event.preventDefault();
                dialogRef.current.focus();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => {
            window.cancelAnimationFrame(focusTimer);
            document.removeEventListener("keydown", handleKeyDown);
            document.body.style.overflow = oldOverflow;
            document.body.style.paddingRight = oldPaddingRight;
            backgroundState.forEach(({ element, ariaHidden, inert }) => {
                element.inert = inert;
                if (ariaHidden === null) element.removeAttribute("aria-hidden");
                else element.setAttribute("aria-hidden", ariaHidden);
            });
            previousFocusRef.current?.focus();
        };
    }, [isOpen, onClose]);

    const handleInputChange =
        (field: keyof typeof formData) => (event: React.ChangeEvent<HTMLInputElement>) => {
            setFormData((current) => ({ ...current, [field]: event.target.value }));
            if (error) setError("");
        };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!isLogin && registrationEnabled && !hasConsent) {
            setError("Чтобы создать аккаунт, отметьте согласие на обработку данных.");
            return;
        }
        setError("");
        setIsLoading(true);

        try {
            if (isLogin || !registrationEnabled) {
                const result = await login({
                    email: formData.email,
                    password: formData.password,
                });
                if (result.status === "code-required") {
                    setPendingCode(result.challenge);
                    return;
                }
            } else {
                await register({ ...formData, consentVersion: CURRENT_CONSENT_VERSION });
            }
            onClose();
        } catch (caughtError: unknown) {
            setError(caughtError instanceof Error ? caughtError.message : "Произошла ошибка");
        } finally {
            setIsLoading(false);
        }
    };

    const handleCodeSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!pendingCode) return;
        setError("");
        setNotice("");
        setIsLoading(true);

        try {
            await confirmLoginCode(pendingCode.challenge, code);
            onClose();
        } catch (caughtError: unknown) {
            // Spent, expired or out of attempts: only a new password step helps.
            if (caughtError instanceof ApiError && caughtError.status === 410) {
                setPendingCode(null);
                setFormData((current) => ({ ...current, password: "" }));
            }
            setCode("");
            setError(caughtError instanceof Error ? caughtError.message : "Произошла ошибка");
        } finally {
            setIsLoading(false);
        }
    };

    const resendCode = async () => {
        setError("");
        setNotice("");
        setIsLoading(true);
        try {
            const result = await login({ email: formData.email, password: formData.password });
            if (result.status === "code-required") {
                setPendingCode(result.challenge);
                setCode("");
                setNotice("Отправили новый код. Прежний больше не действует.");
            } else {
                onClose();
            }
        } catch (caughtError: unknown) {
            setError(caughtError instanceof Error ? caughtError.message : "Произошла ошибка");
        } finally {
            setIsLoading(false);
        }
    };

    const cancelCode = () => {
        setPendingCode(null);
        setCode("");
        setError("");
        setNotice("");
        setFormData((current) => ({ ...current, password: "" }));
    };

    const toggleMode = () => {
        if (!registrationEnabled) return;
        setIsLogin((current) => !current);
        setFormData({ name: "", email: "", password: "" });
        setHasConsent(false);
        setError("");
    };

    if (!isOpen) return null;

    const description = pendingCode
        ? `Мы отправили код на ${formData.email}. Он действует 10 минут.`
        : isLogin
          ? "Введите email и пароль, чтобы войти."
          : "Введите имя, email и пароль, чтобы создать аккаунт.";

    return (
        <div
            className={styles.overlay}
            data-auth-overlay="true"
            onPointerDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div
                aria-describedby={descriptionId}
                aria-labelledby={titleId}
                aria-modal="true"
                className={styles.modal}
                ref={dialogRef}
                role="dialog"
                tabIndex={-1}
            >
                <button
                    aria-label="Закрыть окно входа"
                    className={styles.closeButton}
                    onClick={onClose}
                    type="button"
                >
                    <span aria-hidden="true">×</span>
                </button>

                <header className={styles.header}>
                    <h2 className={styles.title} id={titleId}>
                        {pendingCode ? "Код из письма" : isLogin ? "Вход" : "Регистрация"}
                    </h2>
                    <p className={styles.subtitle} id={descriptionId}>
                        {description}
                    </p>
                </header>

                {pendingCode ? (
                    <form aria-busy={isLoading} className={styles.form} onSubmit={handleCodeSubmit}>
                        {error ? (
                            <div
                                aria-live="assertive"
                                className={styles.error}
                                id={errorId}
                                role="alert"
                            >
                                {error}
                            </div>
                        ) : null}
                        {notice ? (
                            <p aria-live="polite" className={styles.notice}>
                                {notice}
                            </p>
                        ) : null}

                        <div className={styles.inputGroup}>
                            <label className={styles.label} htmlFor={codeId}>
                                Код подтверждения
                            </label>
                            <InputText
                                aria-describedby={error ? `${codeHintId} ${errorId}` : codeHintId}
                                autoComplete="one-time-code"
                                className={`${styles.input} ${styles.codeInput}`}
                                id={codeId}
                                inputMode="numeric"
                                maxLength={6}
                                onChange={(event) => {
                                    setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                                    if (error) setError("");
                                }}
                                pattern="\d{6}"
                                placeholder="000000"
                                ref={codeRef}
                                required
                                value={code}
                            />
                            <p className={styles.hint} id={codeHintId}>
                                Вход в аккаунт администратора подтверждается кодом из письма. В этом
                                браузере код не понадобится 30 дней.
                            </p>
                        </div>

                        <button
                            className={styles.submitButton}
                            disabled={isLoading || code.length !== 6}
                            type="submit"
                        >
                            {isLoading ? "Подождите…" : "Подтвердить"}
                        </button>
                        <div className={styles.codeActions}>
                            <button
                                className={styles.switchButton}
                                disabled={isLoading}
                                onClick={resendCode}
                                type="button"
                            >
                                Отправить новый код
                            </button>
                            <button
                                className={styles.switchButton}
                                disabled={isLoading}
                                onClick={cancelCode}
                                type="button"
                            >
                                Назад
                            </button>
                        </div>
                    </form>
                ) : (
                    <form aria-busy={isLoading} className={styles.form} onSubmit={handleSubmit}>
                        {error ? (
                            <div
                                aria-live="assertive"
                                className={styles.error}
                                id={errorId}
                                role="alert"
                            >
                                {error}
                            </div>
                        ) : null}

                        {!isLogin && registrationEnabled ? (
                            <div className={styles.inputGroup}>
                                <label className={styles.label} htmlFor={nameId}>
                                    Имя
                                </label>
                                <InputText
                                    autoComplete="name"
                                    className={styles.input}
                                    id={nameId}
                                    onChange={handleInputChange("name")}
                                    placeholder="Введите ваше имя"
                                    required
                                    value={formData.name}
                                />
                            </div>
                        ) : null}

                        <div className={styles.inputGroup}>
                            <label className={styles.label} htmlFor={emailId}>
                                Email
                            </label>
                            <InputText
                                aria-describedby={error ? errorId : undefined}
                                autoComplete="email"
                                className={styles.input}
                                id={emailId}
                                onChange={handleInputChange("email")}
                                placeholder="name@example.com"
                                ref={emailRef}
                                required
                                type="email"
                                value={formData.email}
                            />
                        </div>

                        <div className={styles.inputGroup}>
                            <label className={styles.label} htmlFor={passwordId}>
                                Пароль
                            </label>
                            <InputText
                                aria-describedby={error ? errorId : undefined}
                                autoComplete={isLogin ? "current-password" : "new-password"}
                                className={styles.input}
                                id={passwordId}
                                minLength={8}
                                onChange={handleInputChange("password")}
                                placeholder="Введите пароль"
                                required
                                type="password"
                                value={formData.password}
                            />
                        </div>

                        {!isLogin && registrationEnabled ? (
                            <Checkbox
                                checked={hasConsent}
                                className={styles.consent}
                                description={
                                    <>
                                        <Link href="/consent" target="_blank">
                                            Текст согласия
                                        </Link>
                                        {" · "}
                                        <Link href="/privacy" target="_blank">
                                            Политика обработки данных
                                        </Link>
                                    </>
                                }
                                label="Я даю согласие на обработку моих персональных данных"
                                onChange={(event) => setHasConsent(event.target.checked)}
                                required
                            />
                        ) : null}

                        {isLogin ? (
                            <Link
                                className={styles.forgotLink}
                                href="/auth/forgot"
                                onClick={onClose}
                            >
                                Забыли пароль?
                            </Link>
                        ) : null}

                        <button className={styles.submitButton} disabled={isLoading} type="submit">
                            {isLoading ? "Подождите…" : isLogin ? "Войти" : "Зарегистрироваться"}
                        </button>
                    </form>
                )}

                {registrationEnabled && !pendingCode ? (
                    <div className={styles.switchMode}>
                        <p>
                            {isLogin ? "Нет аккаунта?" : "Уже есть аккаунт?"}
                            <button
                                className={styles.switchButton}
                                onClick={toggleMode}
                                type="button"
                            >
                                {isLogin ? "Зарегистрироваться" : "Войти"}
                            </button>
                        </p>
                    </div>
                ) : null}
            </div>
        </div>
    );
};

export default AuthModal;
