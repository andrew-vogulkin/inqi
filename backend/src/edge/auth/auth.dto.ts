import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import { AuthRole } from '@inqi/shared';

/** POST /auth/google — a Google ID token obtained client-side (or `stub:<email>` in dev). */
export class GoogleSignInDto {
  @ApiProperty({ description: 'Google ID token (client-side), or `stub:<email>` when AUTH_VERIFIER=stub', example: 'stub:ada@example.com' })
  @IsString()
  @MinLength(1)
  idToken!: string;
}

export class CustomerDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ required: false, nullable: true }) name?: string | null;
  @ApiProperty({ enum: AuthRole }) role!: AuthRole;
}

export class SessionDto {
  @ApiProperty({ description: 'Bearer session token (send as Authorization: Bearer …)' }) token!: string;
  @ApiProperty({ type: CustomerDto }) customer!: CustomerDto;
}

export class MeDto {
  @ApiProperty() sub!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: AuthRole }) role!: AuthRole;
}
