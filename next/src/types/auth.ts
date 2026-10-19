export type UserRole = "designer" | "admin";

export interface User {
    id: number;
    name: string;
    email: string;
    role: UserRole;
}

export interface AuthResponse {
    user: User;
    token: string;
}

export interface RegisterData {
    name: string;
    email: string;
    password: string;
}

export interface LoginData {
    email: string;
    password: string;
}
