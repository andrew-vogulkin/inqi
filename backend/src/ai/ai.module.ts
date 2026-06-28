import { Global, Module } from '@nestjs/common';
import { QwenService } from './qwen.service';
@Global()
@Module({ providers: [QwenService], exports: [QwenService] })
export class AiModule {}
