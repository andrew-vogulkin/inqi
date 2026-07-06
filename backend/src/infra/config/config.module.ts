import { Global, Module } from '@nestjs/common';
import { ConfigService } from './config.service';

/** Infra (@Global): typed env/secrets access. */
@Global()
@Module({ providers: [ConfigService], exports: [ConfigService] })
export class ConfigModule {}
