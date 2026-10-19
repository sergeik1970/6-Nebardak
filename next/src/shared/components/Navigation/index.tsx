import Image from "next/image";
import Link from "next/link";
import React, { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../../contexts/AuthContext";
import { authUiMode, isAuthRegistrationEnabled } from "@/shared/config/runtime";
import AuthModal from "../AuthModal";
import BetaBadge from "../BetaBadge";
import styles from "./index.module.scss";

const focusableSelector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
].join(",");

const Navigation: React.FC = () => {
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const { user, isAuthenticated, logout } = useAuth();
    const authEnabled = authUiMode !== "off";
    const authButtonLabel = authUiMode === "login-registration" ? "Войти / регистрация" : "Войти";

    const closeMenu = useCallback(() => setIsMenuOpen(false), []);

    const openAuthModal = () => {
        setIsMenuOpen(false);
        setIsAuthModalOpen(true);
    };

    const handleLogout = () => {
        logout();
        closeMenu();
    };

    useEffect(() => {
        if (!isMenuOpen) return;

        const previousOverflow = document.body.style.overflow;
        const previousPaddingRight = document.body.style.paddingRight;
        const trigger = triggerRef.current;
        const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
        document.body.style.overflow = "hidden";
        if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;

        const backgroundElements = Array.from(
            document.querySelectorAll<HTMLElement>("main, footer"),
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

        const focusTimer = window.requestAnimationFrame(() => {
            menuRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus();
        });

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                closeMenu();
                return;
            }
            if (event.key !== "Tab" || !menuRef.current) return;

            const focusable = Array.from(
                menuRef.current.querySelectorAll<HTMLElement>(focusableSelector),
            ).filter((element) => !element.hasAttribute("disabled"));
            if (focusable.length === 0) {
                event.preventDefault();
                menuRef.current.focus();
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

        const handleOutsidePointer = (event: PointerEvent) => {
            const target = event.target as Node;
            if (!menuRef.current?.contains(target) && !trigger?.contains(target)) closeMenu();
        };

        document.addEventListener("keydown", handleKeyDown);
        document.addEventListener("pointerdown", handleOutsidePointer);
        return () => {
            window.cancelAnimationFrame(focusTimer);
            document.removeEventListener("keydown", handleKeyDown);
            document.removeEventListener("pointerdown", handleOutsidePointer);
            document.body.style.overflow = previousOverflow;
            document.body.style.paddingRight = previousPaddingRight;
            backgroundState.forEach(({ element, ariaHidden, inert }) => {
                element.inert = inert;
                if (ariaHidden === null) element.removeAttribute("aria-hidden");
                else element.setAttribute("aria-hidden", ariaHidden);
            });
            trigger?.focus();
        };
    }, [closeMenu, isMenuOpen]);

    useEffect(() => {
        const desktop = window.matchMedia("(min-width: 768px)");
        const closeOnDesktop = (event: MediaQueryListEvent) => {
            if (event.matches) closeMenu();
        };
        desktop.addEventListener("change", closeOnDesktop);
        return () => desktop.removeEventListener("change", closeOnDesktop);
    }, [closeMenu]);

    const navigationLinks = (
        <>
            <Link className={styles["nav-link"]} href="/">
                Главная
            </Link>
            <Link className={styles["nav-link"]} href="/#about">
                О нас
            </Link>
            <Link className={styles["nav-link"]} href="/#contacts">
                Контакты
            </Link>
            <Link className={styles["nav-link"]} href="/test">
                Тест
            </Link>
            {user?.role === "admin" ? (
                <Link
                    aria-label="Открыть администрирование расстановок"
                    className={styles.adminAccessEntry}
                    data-admin-entry="true"
                    href="/admin/planner-observations"
                >
                    Администрирование расстановок
                </Link>
            ) : null}
        </>
    );

    return (
        <Fragment>
            <nav
                aria-label="Основная навигация"
                className={styles.navigation}
                data-auth-background="true"
            >
                <a className={styles.skipLink} href="#main-content">
                    Перейти к основному содержанию
                </a>
                <div className={styles["nav-container"]}>
                    <div className={styles.brand}>
                        <Link
                            aria-label="StyleFinder — перейти на главную"
                            className={styles["nav-logo"]}
                            href="/"
                        >
                            <Image
                                alt=""
                                className={styles["logo-image"]}
                                height={50}
                                priority
                                quality={80}
                                src="/images/Home/logo.79c74b88fecb.jpg"
                                width={50}
                            />
                        </Link>
                        <BetaBadge />
                    </div>

                    <div className={styles["nav-menu"]}>
                        {navigationLinks}
                        {authEnabled && isAuthenticated ? (
                            <div className={styles["user-menu"]}>
                                <span className={styles["user-name"]}>Привет, {user?.name}!</span>
                                <button
                                    className={styles["nav-logout-btn"]}
                                    onClick={handleLogout}
                                    type="button"
                                >
                                    Выйти
                                </button>
                            </div>
                        ) : authEnabled ? (
                            <button
                                className={styles["nav-register-btn"]}
                                onClick={openAuthModal}
                                type="button"
                            >
                                {authButtonLabel}
                            </button>
                        ) : null}
                    </div>

                    <button
                        aria-controls="mobile-navigation"
                        aria-expanded={isMenuOpen}
                        aria-haspopup="dialog"
                        aria-label={isMenuOpen ? "Закрыть меню" : "Открыть меню"}
                        className={`${styles["burger-menu"]} ${isMenuOpen ? styles.active : ""}`}
                        onClick={() => setIsMenuOpen((current) => !current)}
                        ref={triggerRef}
                        type="button"
                    >
                        <span />
                        <span />
                        <span />
                    </button>

                    {isMenuOpen ? (
                        <div
                            aria-hidden="true"
                            className={styles.backdrop}
                            data-mobile-menu-backdrop="true"
                        />
                    ) : null}
                    <div
                        aria-label="Меню сайта"
                        aria-modal="true"
                        className={`${styles["mobile-menu"]} ${isMenuOpen ? styles.active : ""}`}
                        hidden={!isMenuOpen}
                        id="mobile-navigation"
                        ref={menuRef}
                        role="dialog"
                        tabIndex={-1}
                    >
                        <div className={styles["mobile-menu-header"]}>
                            <Link
                                className={styles["mobile-menu-title"]}
                                href="/"
                                onClick={closeMenu}
                            >
                                StyleFinder
                            </Link>
                            <button
                                aria-label="Закрыть меню"
                                className={styles["mobile-menu-close"]}
                                onClick={closeMenu}
                                type="button"
                            >
                                <span aria-hidden="true">×</span>
                            </button>
                        </div>
                        <div aria-hidden="true" className={styles["mobile-menu-divider"]} />

                        {authEnabled && isAuthenticated ? (
                            <>
                                <div className={styles["mobile-user-info"]}>
                                    Привет, {user?.name}!
                                </div>
                                <button
                                    className={styles["mobile-nav-link"]}
                                    onClick={handleLogout}
                                    type="button"
                                >
                                    Выйти
                                </button>
                            </>
                        ) : authEnabled ? (
                            <button
                                className={styles["mobile-nav-link"]}
                                onClick={openAuthModal}
                                type="button"
                            >
                                {authButtonLabel}
                            </button>
                        ) : null}

                        <Link className={styles["mobile-nav-link"]} href="/" onClick={closeMenu}>
                            Главная
                        </Link>
                        <Link
                            className={styles["mobile-nav-link"]}
                            href="/#about"
                            onClick={closeMenu}
                        >
                            О нас
                        </Link>
                        <Link
                            className={styles["mobile-nav-link"]}
                            href="/#contacts"
                            onClick={closeMenu}
                        >
                            Контакты
                        </Link>
                        <Link
                            className={styles["mobile-nav-link"]}
                            href="/test"
                            onClick={closeMenu}
                        >
                            Тест
                        </Link>
                    </div>
                </div>
            </nav>

            {authEnabled ? (
                <AuthModal
                    isOpen={isAuthModalOpen}
                    onClose={() => setIsAuthModalOpen(false)}
                    registrationEnabled={isAuthRegistrationEnabled}
                />
            ) : null}
        </Fragment>
    );
};

export default Navigation;
