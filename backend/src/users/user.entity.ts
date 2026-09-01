import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // `unique: true` creates the unique constraint that backs login/register
  // uniqueness; it is NOT duplicated as a second named index.
  @Column({ type: 'varchar', length: 320, unique: true })
  email: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  /**
   * SECURITY: bcrypt hash. `select: false` means it is omitted from every
   * default query - it can only be fetched explicitly via `.addSelect()` in
   * the login flow, which prevents accidental leakage through serialisation.
   */
  @Column({ name: 'password_hash', type: 'varchar', length: 255, select: false })
  passwordHash: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  /** Soft delete. TypeORM's softRemove/softDelete populates this automatically. */
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
