import React, { useEffect, useId, useRef, useState } from "react";
import { useAuth } from "../../../contexts/AuthContext";
import { isAuthRegistrationEnabled } from "@/shared/config/runtime";
import InputText from "../InputText";
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
    const [error, setError] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const dialogRef = useRef<HTMLDivElement>(null);
    const emailRef = useRef<HTMLInputElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);
    const titleId = useId();
    const descriptionId = useId();
    const errorId = useId();
    const nameId = useId();
    const emailId = useId();
    const passwordId = useId();

    const { login, register } = useAuth();

    useEffect(() => {
        if (!registrationEnabled && !isLogin) setIsLogin(true);
    }, [isLogin, registrationEnabled]);

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
        setError("");
        setIsLoading(true);

        try {
            if (isLogin || !registrationEnabled) {
                await login({ email: formData.email, password: formData.password });
            } else {
                await register(formData);
            }
            onClose();
        } catch (caughtError: unknown) {
            setError(caughtError instanceof Error ? caughtError.message : "Произошла ошибка");
        } finally {
            setIsLoading(false);
        }
    };

    const toggleMode = () => {
        if (!registrationEnabled) return;
        setIsLogin((current) => !current);
        setFormData({ name: "", email: "", password: "" });
        setError("");
    };

    if (!isOpen) return null;

    const description = isLogin
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
                        {isLogin ? "Вход" : "Регистрация"}
                    </h2>
                    <p className={styles.subtitle} id={descriptionId}>
                        {description}
                    </p>
                </header>

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

                    <button className={styles.submitButton} disabled={isLoading} type="submit">
                        {isLoading ? "Подождите…" : isLogin ? "Войти" : "Зарегистрироваться"}
                    </button>
                </form>

                {registrationEnabled ? (
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
