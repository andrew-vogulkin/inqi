import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { QwenProviderBase } from './qwen-provider.base';

/**
 * qwen_local — the local model on spark (llama.cpp, OpenAI-compatible, no auth).
 * Considered configured whenever an endpoint is set, since it needs no API key.
 */
@Injectable()
export class QwenLocalProvider extends QwenProviderBase {
  constructor(config: ConfigService) {
    const profile = config.qwenLocal;
    super({ ...profile, configured: !!profile.baseUrl });
  }
}
