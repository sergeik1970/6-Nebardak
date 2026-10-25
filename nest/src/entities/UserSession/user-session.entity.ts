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
 * A browser sign-in. Only the SHA-256 of the cookie token is stored, so a
 * database read never yields a usable session.
 */
@Entity({ name: "user_session" })
@Index("IDX_user_session_user", ["user"])
export class UserSession {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @ManyToOne(() => User, { nullable: false, onDelete: "CASCADE" })
    @JoinColumn({ name: "user_id" })
    user: User;

    @Column({ name: "token_hash", type: "char", length: 64, unique: true })
    tokenHash: string;

    @CreateDateColumn({ name: "created_at", type: "timestamptz" })
    createdAt: Date;

    @Column({ name: "last_seen_at", type: "timestamptz" })
    lastSeenAt: Date;

    /** Sliding idle expiry, never later than `absoluteExpiresAt`. */
    @Column({ name: "expires_at", type: "timestamptz" })
    expiresAt: Date;

    @Column({ name: "absolute_expires_at", type: "timestamptz" })
    absoluteExpiresAt: Date;

    /** Set when the sign-in also passed the emailed code; admin routes require it. */
    @Column({ name: "second_factor_at", type: "timestamptz", nullable: true })
    secondFactorAt: Date | null;

    @Column({
        name: "user_agent",
        type: "varchar",
        length: 200,
        nullable: true,
    })
    userAgent: string | null;
}
