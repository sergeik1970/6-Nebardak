import React from "react";
import styles from "./index.module.scss";

const Footer: React.FC = () => {
    return (
        <footer className={styles.footer}>
            <div className={styles["footer-container"]}>
                <div className={styles["footer-content"]}>
                    {/* Левая колонка - основная информация */}
                    <div className={styles["footer-main"]}>
                        <h2 className={styles["footer-title"]}>НЕБАРДАК</h2>

                        <div className={styles["footer-contacts"]}>
                            <div className={styles["contact-item"]}>
                                <div className={styles["contact-icon"]}>
                                    <img
                                        src="/images/Home/tg-logo.jpg"
                                        alt="Telegram"
                                        className={styles["contact-icon-img"]}
                                    />
                                </div>
                                <span className={styles["contact-text"]}>@Keltiel</span>
                            </div>

                            <div className={styles["contact-item"]}>
                                <div className={styles["contact-icon"]}>
                                    <img
                                        src="/images/Home/phone-logo.jpg"
                                        alt="Phone"
                                        className={styles["contact-icon-img"]}
                                    />
                                </div>
                                <span className={styles["contact-text"]}>+7 905 150 52 04</span>
                            </div>
                        </div>
                    </div>

                    {/* Правая колонка - навигация (показывается только на планшетах и больше) */}
                    <div className={styles["footer-navigation"]}>
                        <nav className={styles["footer-nav"]}>
                            <a href="/" className={styles["footer-nav-link"]}>
                                Главная
                            </a>
                            <a href="/about" className={styles["footer-nav-link"]}>
                                О нас
                            </a>
                            <a href="/test" className={styles["footer-nav-link"]}>
                                Тест
                            </a>
                        </nav>
                    </div>
                </div>
            </div>
        </footer>
    );
};

export default Footer;
