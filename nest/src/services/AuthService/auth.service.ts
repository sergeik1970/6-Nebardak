import {
    ConflictException,
    Injectable,
    UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { User } from "../../entities/User/user.entity";
import { QueryFailedError, Repository } from "typeorm";
import * as bcrypt from "bcryptjs";
import * as jwt from "jsonwebtoken";
import { RegisterDto } from "../../dto/auth/register.dto";
import { LoginDto } from "../../dto/auth/login.dto";
import { getRuntimeConfig } from "../../config/runtime.config";
import { assertBcryptPasswordLength } from "../../security/bcrypt-password.policy";
import { UserRole } from "../../entities/User/user.entity";

export interface AuthResponse {
    user: {
        id: number;
        name: string;
        email: string;
        role: UserRole;
    };
    token: string;
}

@Injectable()
export class AuthService {
    private readonly jwtSecret?: string;
    private readonly jwtIssuer: string;
    private readonly jwtAudience: string;
    private readonly jwtExpiresIn: jwt.SignOptions["expiresIn"] = "24h";
    private readonly passwordHashCost = 12;
    private readonly dummyPasswordHash =
        "$2b$12$YrfZoa2evRXChcix.a9odus2MkdPhEopc5Ycq6Q0A6G7nURa9VGde";

    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
    ) {
        const runtime = getRuntimeConfig();
        if (runtime.authEnabled && !runtime.jwtSecret) {
            throw new Error("JWT_SECRET is required for the auth service");
        }
        this.jwtSecret = runtime.jwtSecret;
        this.jwtIssuer = runtime.jwtIssuer;
        this.jwtAudience = runtime.jwtAudience;
    }

    async register(registerDto: RegisterDto): Promise<AuthResponse> {
        const { name, password } = registerDto;
        assertBcryptPasswordLength(password);
        const jwtSecret = this.requireSigningSecret();
        const email = this.normalizeEmail(registerDto.email);

        const existingUser = await this.findByEmail(email);
        if (existingUser) {
            throw new ConflictException(
                "Пользователь с таким email уже существует",
            );
        }

        const hashedPassword = await bcrypt.hash(
            password,
            this.passwordHashCost,
        );

        const user = this.userRepository.create({
            name,
            email,
            password: hashedPassword,
            role: "designer",
        });

        let savedUser: User;
        try {
            savedUser = await this.userRepository.save(user);
        } catch (error) {
            if (this.isUniqueViolation(error)) {
                throw new ConflictException(
                    "Пользователь с таким email уже существует",
                );
            }
            throw error;
        }

        const token = this.signToken(savedUser, jwtSecret);

        return {
            user: {
                id: savedUser.id,
                name: savedUser.name,
                email: savedUser.email,
                role: savedUser.role,
            },
            token,
        };
    }

    async login(loginDto: LoginDto): Promise<AuthResponse> {
        const { password } = loginDto;
        assertBcryptPasswordLength(password);
        const jwtSecret = this.requireSigningSecret();
        const email = this.normalizeEmail(loginDto.email);

        const user = await this.findByEmail(email, true);
        if (!user) {
            await this.performDummyPasswordCheck(password);
            throw this.invalidCredentials();
        }

        // Hashes below the current cost are intentionally never compared with
        // the supplied password. Those accounts require a forced password
        // reset; dummy cost-12 work keeps the response non-enumerable.
        if (!this.hasAcceptedPasswordCost(user.password)) {
            await this.performDummyPasswordCheck(password);
            throw this.invalidCredentials();
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            throw this.invalidCredentials();
        }

        const token = this.signToken(user, jwtSecret);

        return {
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
            },
            token,
        };
    }

    async validateToken(token: string): Promise<User | null> {
        if (!this.jwtSecret) return null;

        try {
            const decoded = jwt.verify(token, this.jwtSecret, {
                algorithms: ["HS256"],
                issuer: this.jwtIssuer,
                audience: this.jwtAudience,
            }) as jwt.JwtPayload;
            const userId = Number(decoded.sub ?? decoded.userId);
            if (!Number.isSafeInteger(userId) || userId <= 0) return null;

            const user = await this.userRepository.findOne({
                where: { id: userId },
            });
            return user;
        } catch {
            return null;
        }
    }

    async getUserById(id: number): Promise<User | null> {
        return this.userRepository.findOne({ where: { id } });
    }

    private normalizeEmail(email: string): string {
        return email.trim().toLowerCase();
    }

    private requireSigningSecret(): string {
        if (!this.jwtSecret) {
            throw new Error("JWT_SECRET is required for the auth service");
        }
        return this.jwtSecret;
    }

    private signToken(user: User, secret: string): string {
        return jwt.sign({ sub: user.id, email: user.email }, secret, {
            algorithm: "HS256",
            expiresIn: this.jwtExpiresIn,
            issuer: this.jwtIssuer,
            audience: this.jwtAudience,
        });
    }

    private hasAcceptedPasswordCost(hash: string): boolean {
        try {
            return bcrypt.getRounds(hash) >= this.passwordHashCost;
        } catch {
            return false;
        }
    }

    private performDummyPasswordCheck(password: string): Promise<boolean> {
        return bcrypt.compare(password, this.dummyPasswordHash);
    }

    private invalidCredentials(): UnauthorizedException {
        return new UnauthorizedException("Неверный email или пароль");
    }

    private findByEmail(
        email: string,
        includePassword = false,
    ): Promise<User | null> {
        const query = this.userRepository
            .createQueryBuilder("user")
            .where("LOWER(user.email) = :email", { email });

        if (includePassword) {
            query.addSelect("user.password");
        }

        return query.getOne();
    }

    private isUniqueViolation(error: unknown): boolean {
        if (!(error instanceof QueryFailedError)) return false;
        const driverError = error.driverError as { code?: string };
        return driverError.code === "23505";
    }
}
