import {
    Body,
    Controller,
    Post,
    Get,
    HttpException,
    HttpStatus,
    Headers,
} from "@nestjs/common";
import {
    AuthService,
    RegisterDto,
    LoginDto,
} from "../../services/AuthService/auth.service";

@Controller()
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    @Post("auth/register")
    async register(@Body() registerDto: RegisterDto) {
        try {
            const { name, email, password } = registerDto;

            // Валидация
            if (!name || !email || !password) {
                throw new HttpException(
                    "Все поля обязательны",
                    HttpStatus.BAD_REQUEST,
                );
            }

            if (password.length < 6) {
                throw new HttpException(
                    "Пароль должен содержать минимум 6 символов",
                    HttpStatus.BAD_REQUEST,
                );
            }

            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                throw new HttpException(
                    "Неверный формат email",
                    HttpStatus.BAD_REQUEST,
                );
            }

            return await this.authService.register(registerDto);
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            throw new HttpException(
                "Ошибка при регистрации",
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    @Post("auth/login")
    async login(@Body() loginDto: LoginDto) {
        try {
            const { email, password } = loginDto;

            // Валидация
            if (!email || !password) {
                throw new HttpException(
                    "Email и пароль обязательны",
                    HttpStatus.BAD_REQUEST,
                );
            }

            return await this.authService.login(loginDto);
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            throw new HttpException(
                "Ошибка при входе",
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    @Get("auth/me")
    async getProfile(@Headers("authorization") authorization: string) {
        try {
            if (!authorization) {
                throw new HttpException(
                    "Токен не предоставлен",
                    HttpStatus.UNAUTHORIZED,
                );
            }

            const token = authorization.replace("Bearer ", "");
            const user = await this.authService.validateToken(token);

            if (!user) {
                throw new HttpException(
                    "Недействительный токен",
                    HttpStatus.UNAUTHORIZED,
                );
            }

            return {
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                },
            };
        } catch (error) {
            if (error instanceof HttpException) {
                throw error;
            }
            throw new HttpException(
                "Ошибка при получении профиля",
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }
}
