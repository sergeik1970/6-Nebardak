import React from "react";
import Link from "next/link";
import styles from "./index.module.scss";

const Header: React.FC = () => {
    return (
        <header className={styles.header}>
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
