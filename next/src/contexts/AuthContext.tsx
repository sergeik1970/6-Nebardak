import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
    children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        authService.clearLegacyStorage();

        if (!isAuthEnabled) {
            setIsLoading(false);
            return;
        }

        let cancelled = false;
        // The HttpOnly cookie is invisible to scripts, so the server decides.
        authService
            .getSession()
            .then((profile) => {
                if (!cancelled) setUser(profile);
            })
            .catch(() => {
                if (!cancelled) setUser(null);
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    const login = useCallback(async (data: LoginData) => {
        if (!isAuthEnabled) {
            throw new Error("Авторизация недоступна в демо-режиме");
        }

        const response = await authService.login(data);
        setUser(response.user);
    }, []);

    const register = useCallback(async (data: RegisterData) => {
        if (!isAuthEnabled || !isAuthRegistrationEnabled) {
            throw new Error("Регистрация сейчас отключена");
        }

        const response = await authService.register(data);
        setUser(response.user);
    }, []);

    const logout = useCallback(async () => {
        try {
            await authService.logout();
        } finally {
            setUser(null);
        }
    }, []);

    const logoutEverywhere = useCallback(async () => {
        await authService.logoutEverywhere();
        setUser(null);
    }, []);

    const value: AuthContextType = {
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        register,
        logout,
        logoutEverywhere,
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
