import { AuthResponse, RegisterData, LoginData, User } from "../types/auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";

class AuthService {
    private getAuthHeaders() {
        const token = localStorage.getItem("token");
        return {
            "Content-Type": "application/json",
            ...(token && { Authorization: `Bearer ${token}` }),
        };
    }

    async register(data: RegisterData): Promise<AuthResponse> {
        const response = await fetch(`${API_BASE_URL}/auth/register`, {
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
        const response = await fetch(`${API_BASE_URL}/auth/login`, {
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
        const response = await fetch(`${API_BASE_URL}/auth/me`, {
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
        return userStr ? JSON.parse(userStr) : null;
    }

    isAuthenticated(): boolean {
        return !!this.getToken();
    }
}

export const authService = new AuthService();
