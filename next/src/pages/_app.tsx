import "@/styles/globals.scss";
import React, { FC } from "react";
import type { AppProps } from "next/app";
import { AuthProvider } from "@/contexts/AuthContext";

const App: FC<AppProps> = ({ Component, pageProps }) => {
    return (
        <AuthProvider>
            <Component {...pageProps} />
        </AuthProvider>
    );
};
export default App;
