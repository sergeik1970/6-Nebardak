import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { User, RegisterData, LoginData } from "../types/auth";
import { authService } from "../services/authService";
import { isAuthEnabled, isAuthRegistrationEnabled } from "@/shared/config/runtime";

interface AuthContextType {
    user: User | null;
    isLoading: boolean;
    isAuthenticated: boolean;
    login: (data: LoginData) => Promise<void>;
    register: (data: RegisterData) => Promise<void>;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
    children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!isAuthEnabled) {
            authService.logout();
            setUser(null);
            setIsLoading(false);
            return;
        }

        // Проверяем, есть ли сохраненный токен при загрузке
        const initAuth = async () => {
            try {
                const token = authService.getToken();
                if (token) {
                    const profile = await authService.getProfile();
                    setUser(profile.user);
                }
            } catch (error) {
                // Если токен недействителен, удаляем его
                authService.logout();
            } finally {
                setIsLoading(false);
            }
        };

        initAuth();
    }, []);

    const login = async (data: LoginData) => {
        if (!isAuthEnabled) {
            throw new Error("Авторизация недоступна в демо-режиме");
        }

        const response = await authService.login(data);
        setUser(response.user);
    };

    const register = async (data: RegisterData) => {
        if (!isAuthEnabled || !isAuthRegistrationEnabled) {
            throw new Error("Регистрация сейчас отключена");
        }

        const response = await authService.register(data);
        setUser(response.user);
    };

    const logout = () => {
        authService.logout();
        setUser(null);
    };

    const value: AuthContextType = {
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        register,
        logout,
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
