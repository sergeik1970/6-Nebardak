import Head from "next/head";
import React, { ReactNode } from "react";
import Footer from "@/shared/components/Footer";
import Navigation from "@/shared/components/Navigation";
import { hasLegalPlaceholders } from "@/shared/legal/operator";
import styles from "./legal.module.scss";

interface LegalDocumentProps {
    title: string;
    edition: string;
    children: ReactNode;
}

const LegalDocument: React.FC<LegalDocumentProps> = ({ title, edition, children }) => (
    <div className={styles.page}>
        <Head>
            <title>{`${title} · StyleFinder`}</title>
            <meta name="description" content={`${title} StyleFinder.`} />
        </Head>
        <Navigation />
        <main id="main-content" className={styles.main} tabIndex={-1}>
            <article className={styles.document}>
                <h1>{title}</h1>
                <p className={styles.edition}>Редакция от {edition}</p>
                {hasLegalPlaceholders() ? (
                    // Deliberately visible: a draft must never pass for the final text.
                    <p className={styles.draftNotice} role="note">
                        Черновик. Реквизиты оператора в квадратных скобках ещё не заполнены, текст
                        не проверен юристом.
                    </p>
                ) : null}
                {children}
            </article>
        </main>
        <Footer />
    </div>
);

export default LegalDocument;
