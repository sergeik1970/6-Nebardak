import React from "react";
import Link from "next/link";
import styles from "./index.module.scss";

const Header: React.FC = () => {
    return (
        <header className={styles.header}>
            <div className={styles["header-media"]} aria-hidden="true">
                <picture>
                    <source media="(min-width: 1024px)" srcSet="/images/Home/houses-desktop.jpg" />
                    <source media="(min-width: 768px)" srcSet="/images/Home/houses-tablet.jpg" />
                    <img
                        src="/images/Home/houses-mobile.jpg"
                        alt=""
                        className={styles["header-image"]}
                        fetchPriority="high"
                        decoding="async"
                    />
                </picture>
            </div>
            <div className={styles["header-content"]}>
                <Link href="/" className={styles["header-title"]}>
                    StyleFinder
                </Link>
                <p className={styles["header-subtitle"]}>Найди свой стиль</p>
            </div>
        </header>
    );
};

export default Header;
