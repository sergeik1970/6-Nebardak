import { AuthResponse, RegisterData, LoginData, User } from "../types/auth";
import { isAuthEnabled, isAuthRegistrationEnabled } from "@/shared/config/runtime";
import { apiRequest } from "./apiClient";

/** Bearer-era keys. Sessions now live only in an HttpOnly cookie. */
const LEGACY_STORAGE_KEYS = ["token", "user"] as const;

class AuthService {
    async register(data: RegisterData): Promise<AuthResponse> {
        if (!isAuthRegistrationEnabled) {
            throw new Error("Регистрация сейчас отключена");
        }

        return apiRequest<AuthResponse>("/auth/register", {
            method: "POST",
            body: data,
            fallbackMessage: "Ошибка при регистрации",
        });
    }

    async login(data: LoginData): Promise<AuthResponse> {
        return apiRequest<AuthResponse>("/auth/login", {
            method: "POST",
            body: data,
            fallbackMessage: "Ошибка при входе",
        });
    }

    /** The current user, or null for a guest. */
    async getSession(): Promise<User | null> {
        const response = await apiRequest<{ user: User | null }>("/auth/session", {
            fallbackMessage: "Ошибка при получении профиля",
        });
        return response.user;
    }

    async logout(): Promise<void> {
        await apiRequest<void>("/auth/logout", { method: "POST" });
    }

    async logoutEverywhere(): Promise<void> {
        await apiRequest<void>("/auth/logout-all", { method: "POST" });
    }

    clearLegacyStorage(): void {
        if (typeof window === "undefined") return;
        try {
            LEGACY_STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key));
        } catch {
            // Storage can be blocked; there is nothing left to clean then.
        }
    }

    isAvailable(): boolean {
        return isAuthEnabled;
    }

    isRegistrationAvailable(): boolean {
        return isAuthRegistrationEnabled;
    }
}

export const authService = new AuthService();
