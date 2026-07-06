import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { OnUsage, QwenProviderBase } from './qwen-provider.base';

/**
 * qwen_cloud — Qwen on DashScope (cloud, OpenAI-compatible). Configured only when
 * a real API key is set (a `sk-xxxx` placeholder counts as unconfigured, so the
 * pipeline falls back to stubs).
 */
@Injectable()
export class QwenCloudProvider extends QwenProviderBase {
  constructor(config: ConfigService, onUsage?: OnUsage) {
    const profile = config.qwenCloud;
    super({ ...profile, configured: !!profile.apiKey && !/^sk-x+$/i.test(profile.apiKey) }, onUsage);
  }
}
