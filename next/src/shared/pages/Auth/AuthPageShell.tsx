import Head from "next/head";
import React, { ReactNode } from "react";
import Footer from "@/shared/components/Footer";
import Navigation from "@/shared/components/Navigation";
import styles from "./auth-page.module.scss";

interface AuthPageShellProps {
    title: string;
    eyebrow: string;
    heading: string;
    children: ReactNode;
}

/** A focused single-card page for links that arrive by email. */
const AuthPageShell: React.FC<AuthPageShellProps> = ({ title, eyebrow, heading, children }) => (
    <div className={styles.page}>
        <Head>
            <title>{`${title} · StyleFinder`}</title>
            <meta name="robots" content="noindex, nofollow" />
            {/* The one-time token must never leak to another site through Referer. */}
            <meta name="referrer" content="no-referrer" />
        </Head>
        <Navigation />
        <main id="main-content" className={styles.main} tabIndex={-1}>
            <section className={styles.card} aria-labelledby="auth-page-heading">
                <p className={styles.eyebrow}>{eyebrow}</p>
                <h1 id="auth-page-heading">{heading}</h1>
                {children}
            </section>
        </main>
        <Footer />
    </div>
);

export default AuthPageShell;
