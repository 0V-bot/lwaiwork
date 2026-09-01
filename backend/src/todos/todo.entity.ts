import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'todos' })
@Index('IDX_todos_user_created', ['userId', 'createdAt'])
export class Todo {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Owner. Every query in TodosService filters on this column, which is what
   * enforces per-user isolation (horizontal authorisation).
   */
  @Column({ name: 'user_id', type: 'uuid' })
  @Index('IDX_todos_user_id')
  userId: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'boolean', default: false })
  done: boolean;

  @Column({ name: 'due_at', type: 'timestamptz', nullable: true })
  dueAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
