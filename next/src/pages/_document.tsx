import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
    return (
        <Html lang="ru">
            <Head>
                <meta name="theme-color" content="#f28c00" />
                <link rel="manifest" href="/site.webmanifest" />
            </Head>
            <body>
                <Main />
                <NextScript />
            </body>
        </Html>
    );
}
