import Head from "next/head";
import Link from "next/link";
import Footer from "@/shared/components/Footer";
import Navigation from "@/shared/components/Navigation";
import styles from "@/styles/NotFound.module.scss";

export default function NotFoundPage() {
    return (
        <div className={styles.page}>
            <Head>
                <title>Страница не найдена · StyleFinder</title>
                <meta name="robots" content="noindex, nofollow" />
            </Head>
            <Navigation />
            <main id="main-content" className={styles.main} tabIndex={-1}>
                <div className={styles.card}>
                    <p className={styles.code}>404 · ЗДЕСЬ ПОКА ПУСТО</p>
                    <h1>Такой страницы нет</h1>
                    <p>
                        Возможно, ссылка устарела или в адресе есть опечатка. Вернитесь на главную и
                        продолжите с нужного шага.
                    </p>
                    <div className={styles.actions}>
                        <Link href="/" className={styles.primaryAction}>
                            Вернуться на главную
                        </Link>
                        <Link href="/test" className={styles.secondaryAction}>
                            Пройти тест предпочтений
                        </Link>
                    </div>
                </div>
            </main>
            <Footer />
        </div>
    );
}
