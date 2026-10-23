import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
    return (
        <Html lang="ru">
            <Head>
                <meta name="theme-color" content="#f28c00" />
                <link rel="icon" href="/favicon.ico" sizes="32x32" />
                <link rel="icon" href="/icon.svg" type="image/svg+xml" />
                <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
                <link rel="manifest" href="/site.webmanifest" />
            </Head>
            <body>
                <Main />
                <NextScript />
            </body>
        </Html>
    );
}
