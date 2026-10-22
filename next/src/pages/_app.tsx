import "@/styles/globals.scss";
import React, { FC } from "react";
import type { AppProps } from "next/app";
import dynamic from "next/dynamic";
import { AuthProvider } from "@/contexts/AuthContext";
import { AuthModalProvider } from "@/contexts/AuthModalContext";
import Analytics from "@/shared/components/Analytics";
import { isAuthEnabled, yandexMetrikaCounterId } from "@/shared/config/runtime";

// Loaded only with accounts on: it brings the planner's draft code along.
const GuestDraftImport = dynamic(() => import("@/shared/components/GuestDraftImport"), {
    ssr: false,
});

const App: FC<AppProps> = ({ Component, pageProps }) => {
    return (
        <AuthProvider>
            <AuthModalProvider>
                <Component {...pageProps} />
                {isAuthEnabled ? <GuestDraftImport /> : null}
                {yandexMetrikaCounterId !== null ? (
                    <Analytics counterId={yandexMetrikaCounterId} />
                ) : null}
            </AuthModalProvider>
        </AuthProvider>
    );
};
export default App;
