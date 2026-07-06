import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length } from 'class-validator';
import { AuthRole } from '@inqi/shared';

/** POST /auth/email — step 1: request a verification code for this address. */
export class EmailStartDto {
  @ApiProperty({ description: 'The email to sign in with', example: 'ada@example.com' })
  @IsEmail()
  email!: string;
}

export class EmailStartResultDto {
  @ApiProperty({ description: 'The verification code was issued (mock transport for now)' }) sent!: boolean;
}

/** POST /auth/email/verify — step 2: the emailed MFA code (mock: 123456). */
export class EmailVerifyDto {
  @ApiProperty({ description: 'The email from step 1', example: 'ada@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ description: '6-digit verification code (mock transport: 123456)', example: '123456' })
  @IsString()
  @Length(6, 6)
  code!: string;
}

export class CustomerDto {
  @ApiProperty({ example: 'clz1cust0000xy', description: 'Customer id' }) id!: string;
  @ApiProperty({ example: 'ada@example.com' }) email!: string;
  @ApiProperty({ required: false, nullable: true, example: 'Ada Lovelace' }) name?: string | null;
  @ApiProperty({ enum: AuthRole, example: AuthRole.Customer, description: 'Role lives in the DB; admins are marked manually' }) role!: AuthRole;
}

export class SessionDto {
  @ApiProperty({ description: 'Bearer session token (send as Authorization: Bearer …)' }) token!: string;
  @ApiProperty({ type: CustomerDto }) customer!: CustomerDto;
}

export class MeDto {
  @ApiProperty({ example: 'clz1cust0000xy', description: 'Customer id (the session subject)' }) sub!: string;
  @ApiProperty({ example: 'ada@example.com' }) email!: string;
  @ApiProperty({ enum: AuthRole, example: AuthRole.Customer }) role!: AuthRole;
}
