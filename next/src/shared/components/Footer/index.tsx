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

                        <address
                            aria-label="Контакты StyleFinder"
                            className={styles["footer-contacts"]}
                        >
                            <a
                                aria-label="Написать StyleFinder в Telegram, откроется в новой вкладке"
                                className={styles["contact-item"]}
                                href="https://t.me/Keltiel"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                <div className={styles["contact-icon"]}>
                                    <Image
                                        src="/images/Home/tg-logo.d425a67811d3.jpg"
                                        alt=""
                                        width={40}
                                        height={40}
                                        quality={75}
                                        className={styles["contact-icon-img"]}
                                    />
                                </div>
                                <span className={styles["contact-text"]}>@Keltiel</span>
                            </a>

                            <a
                                aria-label="Позвонить в StyleFinder по номеру +7 905 150-52-04"
                                className={styles["contact-item"]}
                                href="tel:+79051505204"
                            >
                                <div className={styles["contact-icon"]}>
                                    <Image
                                        src="/images/Home/phone-logo.a2f42632fbd6.jpg"
                                        alt=""
                                        width={40}
                                        height={40}
                                        quality={75}
                                        className={styles["contact-icon-img"]}
                                    />
                                </div>
                                <span className={styles["contact-text"]}>+7 905 150 52 04</span>
                            </a>
                        </address>
                    </div>

                    {/* Правая колонка - навигация (показывается только на планшетах и больше) */}
                    <div className={styles["footer-navigation"]}>
                        <nav aria-label="Навигация в подвале" className={styles["footer-nav"]}>
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
                {/* Always visible: 152-ФЗ requires the policy to be freely accessible. */}
                <p className={styles["footer-legal"]}>
                    <Link href="/privacy">Политика обработки персональных данных</Link>
                    <Link href="/consent">Согласие на обработку данных</Link>
                    <Link href="/analytics-consent">Согласие на веб-аналитику</Link>
                </p>
            </div>
        </footer>
    );
};

export default Footer;
