import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
} from "typeorm";
import { User } from "../User/user.entity";

/**
 * A browser where the administrator already entered an emailed code. It
 * replaces the code, never the password, until it expires or the account
 * ends all its sign-ins. Only the SHA-256 of the cookie token is stored.
 */
@Entity({ name: "trusted_device" })
@Index("IDX_trusted_device_user", ["user"])
export class TrustedDevice {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @ManyToOne(() => User, { nullable: false, onDelete: "CASCADE" })
    @JoinColumn({ name: "user_id" })
    user: User;

    @Column({ name: "token_hash", type: "char", length: 64, unique: true })
    tokenHash: string;

    @Column({ name: "expires_at", type: "timestamptz" })
    expiresAt: Date;

    @CreateDateColumn({ name: "created_at", type: "timestamptz" })
    createdAt: Date;
}
