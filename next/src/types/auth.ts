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
    /** Edition of the personal-data consent the person accepted. */
    consentVersion: string;
}

export interface LoginData {
    email: string;
    password: string;
}

/** An administrator's password was right; the emailed code is still due. */
export interface SecondFactorChallenge {
    challenge: string;
    expiresAt: string;
}

export type LoginResponse = AuthResponse | { user: null; secondFactor: SecondFactorChallenge };

export type LoginResult =
    | { status: "signed-in" }
    | { status: "code-required"; challenge: SecondFactorChallenge };
