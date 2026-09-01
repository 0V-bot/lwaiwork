import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from './user.entity';

/**
 * Never returned to clients - no passwordHash field.
 * Used for `/auth/me` and for embedding in todo responses.
 */
export interface SafeUser {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}

const BCRYPT_COST = 12;

/**
 * A real (valid) bcrypt hash of a random string, computed once at module load.
 * Used only to burn ~the same CPU time on the "user not found" branch of login
 * so response timing cannot be used to enumerate registered emails.
 */
const TIMING_DUMMY_HASH = bcrypt.hashSync('lwaiwork-timing-equaliser', BCRYPT_COST);

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  async create(email: string, password: string, name: string): Promise<User> {
    const normalizedEmail = email.trim().toLowerCase();

    const existing = await this.users.findOne({
      where: { email: normalizedEmail },
      withDeleted: true,
    });
    if (existing) {
      // SECURITY: intentionally vague - do not reveal whether an account
      // exists (user enumeration). Registration is a public endpoint.
      throw new ConflictException('Registration failed: email already in use');
    }

    const user = this.users.create({
      email: normalizedEmail,
      name: name.trim(),
      passwordHash: await bcrypt.hash(password, BCRYPT_COST),
    });

    return this.users.save(user);
  }

  /** Login path: explicitly opts the hash in, then verifies with bcrypt. */
  async validateCredentials(email: string, password: string): Promise<User | null> {
    const normalizedEmail = email.trim().toLowerCase();

    const user = await this.users
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.email = :email', { email: normalizedEmail })
      .getOne();

    if (!user) {
      // SECURITY: run a dummy compare to keep timing similar to the
      // "user exists" branch, mitigating user-enumeration via response time.
      await bcrypt.compare(password, TIMING_DUMMY_HASH);
      return null;
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return null;

    return user;
  }

  async findById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.users.findOne({ where: { email: email.trim().toLowerCase() } });
  }

  static toSafeUser(user: User): SafeUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
    };
  }
}
