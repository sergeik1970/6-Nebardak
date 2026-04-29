import React from "react";
import Link from "next/link";
import Image from "next/image";
import styles from "./index.module.scss";

const Footer: React.FC = () => {
    return (
        <footer id="contacts" className={styles.footer}>
            <div className={styles["footer-container"]}>
                <div className={styles["footer-content"]}>
                    {/* Левая колонка - основная информация */}
                    <div className={styles["footer-main"]}>
                        <Link href="/" className={styles["footer-title"]}>
                            StyleFinder
                        </Link>

                        <div className={styles["footer-contacts"]}>
                            <div className={styles["contact-item"]}>
                                <div className={styles["contact-icon"]}>
                                    <Image
                                        src="/images/Home/tg-logo.jpg"
                                        alt="Telegram"
                                        width={40}
                                        height={40}
                                        quality={75}
                                        className={styles["contact-icon-img"]}
                                    />
                                </div>
                                <span className={styles["contact-text"]}>@Keltiel</span>
                            </div>

                            <div className={styles["contact-item"]}>
                                <div className={styles["contact-icon"]}>
                                    <Image
                                        src="/images/Home/phone-logo.jpg"
                                        alt="Phone"
                                        width={40}
                                        height={40}
                                        quality={75}
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
                            <Link href="/" className={styles["footer-nav-link"]}>
                                Главная
                            </Link>
                            <Link href="/#about" className={styles["footer-nav-link"]}>
                                О нас
                            </Link>
                            <Link href="/test" className={styles["footer-nav-link"]}>
                                Тест
                            </Link>
                        </nav>
                    </div>
                </div>
            </div>
        </footer>
    );
};

export default Footer;
