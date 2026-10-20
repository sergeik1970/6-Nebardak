import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
    ReactNode,
} from "react";
import { User, RegisterData, LoginData } from "../types/auth";
import { authService } from "../services/authService";
import { isAuthEnabled, isAuthRegistrationEnabled } from "@/shared/config/runtime";

interface AuthContextType {
    user: User | null;
    isLoading: boolean;
    isAuthenticated: boolean;
    login: (data: LoginData) => Promise<void>;
    register: (data: RegisterData) => Promise<void>;
    logout: () => Promise<void>;
    logoutEverywhere: () => Promise<void>;
    verifyEmail: (token: string) => Promise<void>;
    resetPassword: (token: string, password: string) => Promise<void>;
    resendVerification: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
    children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    // Bumped by every explicit change, so a slower page-load probe can never
    // overwrite fresher state (e.g. a sign-in or a just-confirmed email).
    const generationRef = useRef(0);

    const commitUser = useCallback((next: User | null) => {
        generationRef.current += 1;
        setUser(next);
        setIsLoading(false);
    }, []);

    useEffect(() => {
        authService.clearLegacyStorage();

        if (!isAuthEnabled) {
            setIsLoading(false);
            return;
        }

        let cancelled = false;
        const generation = generationRef.current;
        const isCurrent = () => !cancelled && generationRef.current === generation;
        // The HttpOnly cookie is invisible to scripts, so the server decides.
        authService
            .getSession()
            .then((profile) => {
                if (isCurrent()) setUser(profile);
            })
            .catch(() => {
                if (isCurrent()) setUser(null);
            })
            .finally(() => {
                if (isCurrent()) setIsLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    const login = useCallback(
        async (data: LoginData) => {
            if (!isAuthEnabled) {
                throw new Error("Авторизация недоступна в демо-режиме");
            }

            const response = await authService.login(data);
            commitUser(response.user);
        },
        [commitUser],
    );

    const register = useCallback(
        async (data: RegisterData) => {
            if (!isAuthEnabled || !isAuthRegistrationEnabled) {
                throw new Error("Регистрация сейчас отключена");
            }

            const response = await authService.register(data);
            commitUser(response.user);
        },
        [commitUser],
    );

    const logout = useCallback(async () => {
        try {
            await authService.logout();
        } finally {
            commitUser(null);
        }
    }, [commitUser]);

    const logoutEverywhere = useCallback(async () => {
        await authService.logoutEverywhere();
        commitUser(null);
    }, [commitUser]);

    const verifyEmail = useCallback(
        async (token: string) => {
            await authService.verifyEmail(token);
            // The link may be opened signed in as anyone or no one: ask again
            // rather than guess, now that the server has recorded the change.
            try {
                commitUser(await authService.getSession());
            } catch {
                // The confirmation itself succeeded; the banner updates on next load.
            }
        },
        [commitUser],
    );

    const resetPassword = useCallback(
        async (token: string, password: string) => {
            commitUser(await authService.resetPassword(token, password));
        },
        [commitUser],
    );

    const resendVerification = useCallback(() => authService.resendVerification(), []);

    const value: AuthContextType = {
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        register,
        logout,
        logoutEverywhere,
        verifyEmail,
        resetPassword,
        resendVerification,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
};
