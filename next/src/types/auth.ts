export type UserRole = "designer" | "admin";

export interface User {
    id: number;
    name: string;
    email: string;
    role: UserRole;
    emailVerified: boolean;
}

export interface AuthResponse {
    user: User;
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
