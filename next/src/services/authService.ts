import { AuthResponse, RegisterData, LoginData, User } from "../types/auth";
import { AUTH_API_URL, isAuthEnabled } from "@/shared/config/runtime";

const AUTH_DISABLED_MESSAGE =
    "Авторизация временно недоступна: сайт запущен без подключенного API.";

class AuthService {
    private getApiUrl() {
        if (!AUTH_API_URL) {
            throw new Error(AUTH_DISABLED_MESSAGE);
        }
        return AUTH_API_URL;
    }

    private getAuthHeaders() {
        const token = localStorage.getItem("token");
        return {
            "Content-Type": "application/json",
            ...(token && { Authorization: `Bearer ${token}` }),
        };
    }

    async register(data: RegisterData): Promise<AuthResponse> {
        const response = await fetch(`${this.getApiUrl()}/auth/register`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || "Ошибка при регистрации");
        }

        const result = await response.json();

        // Сохраняем токен в localStorage
        localStorage.setItem("token", result.token);
        localStorage.setItem("user", JSON.stringify(result.user));

        return result;
    }

    async login(data: LoginData): Promise<AuthResponse> {
        const response = await fetch(`${this.getApiUrl()}/auth/login`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || "Ошибка при входе");
        }

        const result = await response.json();

        // Сохраняем токен в localStorage
        localStorage.setItem("token", result.token);
        localStorage.setItem("user", JSON.stringify(result.user));

        return result;
    }

    async getProfile(): Promise<{ user: User }> {
        const response = await fetch(`${this.getApiUrl()}/auth/me`, {
            method: "GET",
            headers: this.getAuthHeaders(),
        });

        if (!response.ok) {
            throw new Error("Ошибка при получении профиля");
        }

        return response.json();
    }

    logout(): void {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
    }

    getToken(): string | null {
        return localStorage.getItem("token");
    }

    getUser(): User | null {
        const userStr = localStorage.getItem("user");
        if (!userStr) return null;
        try {
            return JSON.parse(userStr);
        } catch {
            localStorage.removeItem("user");
            return null;
        }
    }

    isAuthenticated(): boolean {
        return !!this.getToken();
    }

    isAvailable(): boolean {
        return isAuthEnabled;
    }
}

export const authService = new AuthService();
