import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { LessThan, MoreThan, Repository } from "typeorm";
import { TrustedDevice } from "../../entities/TrustedDevice/trusted-device.entity";
import { User } from "../../entities/User/user.entity";
import {
    createSecretToken,
    hashSecretToken,
    isSecretTokenFormat,
} from "../../security/secret-token";

const DAY_MS = 24 * 60 * 60_000;

/** Fixed from the code entry, not extended by use: a month, then a new code. */
export const TRUSTED_DEVICE_TTL_MS = 30 * DAY_MS;
export const MAX_TRUSTED_DEVICES_PER_USER = 10;

/**
 * Remembers browsers that passed an administrator's emailed code, so the
 * next sign-in there needs only the password.
 */
@Injectable()
export class TrustedDeviceService {
    constructor(
        @InjectRepository(TrustedDevice)
        private readonly deviceRepository: Repository<TrustedDevice>,
    ) {}

    async issue(
        userId: number,
        now = new Date(),
    ): Promise<{ token: string; expiresAt: Date }> {
        const token = createSecretToken();
        const expiresAt = new Date(now.getTime() + TRUSTED_DEVICE_TTL_MS);
        await this.deviceRepository.save(
            this.deviceRepository.create({
                user: { id: userId } as User,
                tokenHash: hashSecretToken(token),
                expiresAt,
            }),
        );
        await this.pruneUserDevices(userId, now);
        return { token, expiresAt };
    }

    /** True only for an unexpired device issued to this very account. */
    async isTrusted(
        userId: number,
        token: string | undefined,
        now = new Date(),
    ): Promise<boolean> {
        if (!isSecretTokenFormat(token)) return false;

        const device = await this.deviceRepository.findOne({
            where: {
                tokenHash: hashSecretToken(token),
                user: { id: userId },
                expiresAt: MoreThan(now),
            },
        });
        return device !== null;
    }

    async revokeAll(userId: number): Promise<void> {
        await this.deviceRepository.delete({ user: { id: userId } });
    }

    private async pruneUserDevices(userId: number, now: Date): Promise<void> {
        await this.deviceRepository.delete({
            user: { id: userId },
            expiresAt: LessThan(now),
        });

        // Same raw OFFSET query as for sessions: see SessionService.
        const surplus: Array<{ id: string }> = await this.deviceRepository
            .createQueryBuilder("device")
            .select("device.id", "id")
            .where("device.user_id = :userId", { userId })
            .orderBy("device.created_at", "DESC")
            .offset(MAX_TRUSTED_DEVICES_PER_USER)
            .getRawMany();
        if (surplus.length > 0) {
            await this.deviceRepository.delete(
                surplus.map((device) => device.id),
            );
        }
    }
}
