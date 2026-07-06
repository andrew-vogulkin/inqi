import { Module } from '@nestjs/common';
import { EvalService } from './eval.service';

/** Domain: self-improvement (SelfEval) + workflow-version publishing. */
@Module({
  providers: [EvalService],
  exports: [EvalService],
})
export class EvalModule {}
