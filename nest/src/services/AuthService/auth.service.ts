import { Injectable, HttpException, HttpStatus } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { User } from "src/entities/User/user.entity";
import { Repository } from "typeorm";
import * as bcrypt from "bcryptjs";
import * as jwt from "jsonwebtoken";

export interface RegisterDto {
    name: string;
    email: string;
    password: string;
}

export interface LoginDto {
    email: string;
    password: string;
}

export interface AuthResponse {
    user: {
        id: number;
        name: string;
        email: string;
    };
    token: string;
}

@Injectable()
export class AuthService {
    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
    ) {}

    private readonly JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
    private readonly JWT_EXPIRES_IN = "30d"; // 30 дней

    async register(registerDto: RegisterDto): Promise<AuthResponse> {
        const { name, email, password } = registerDto;

        // Проверяем, существует ли пользователь
        const existingUser = await this.userRepository.findOne({
            where: { email },
        });
        if (existingUser) {
            throw new HttpException(
                "Пользователь с таким email уже существует",
                HttpStatus.BAD_REQUEST,
            );
        }

        // Хешируем пароль
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Создаем пользователя
        const user = this.userRepository.create({
            name,
            email,
            password: hashedPassword,
        });

        const savedUser = await this.userRepository.save(user);

        // Генерируем JWT токен
        const token = jwt.sign(
            { userId: savedUser.id, email: savedUser.email },
            this.JWT_SECRET,
            { expiresIn: this.JWT_EXPIRES_IN },
        );

        return {
            user: {
                id: savedUser.id,
                name: savedUser.name,
                email: savedUser.email,
            },
            token,
        };
    }

    async login(loginDto: LoginDto): Promise<AuthResponse> {
        const { email, password } = loginDto;

        // Находим пользователя
        const user = await this.userRepository.findOne({ where: { email } });
        if (!user) {
            throw new HttpException(
                "Неверный email или пароль",
                HttpStatus.UNAUTHORIZED,
            );
        }

        // Проверяем пароль
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            throw new HttpException(
                "Неверный email или пароль",
                HttpStatus.UNAUTHORIZED,
            );
        }

        // Генерируем JWT токен
        const token = jwt.sign(
            { userId: user.id, email: user.email },
            this.JWT_SECRET,
            { expiresIn: this.JWT_EXPIRES_IN },
        );

        return {
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
            },
            token,
        };
    }

    async validateToken(token: string): Promise<User | null> {
        try {
            const decoded = jwt.verify(token, this.JWT_SECRET) as any;
            const user = await this.userRepository.findOne({
                where: { id: decoded.userId },
            });
            return user;
        } catch (error) {
            return null;
        }
    }

    async getUserById(id: number): Promise<User | null> {
        return this.userRepository.findOne({ where: { id } });
    }
}
