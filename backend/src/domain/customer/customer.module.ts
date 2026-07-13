import { Global, Module } from '@nestjs/common';
import { CustomerService } from './customer.service';
import { CustomerRepository } from './customer.repository';

/**
 * Domain: authenticated customer identities (HP-10). @Global because AuthGuard
 * (HP-25 suspension check) depends on CustomerService, and AuthGuard is instantiated
 * in every module that guards a route (auth / public / capability-token) — global
 * export keeps it resolvable in each without threading the import through all of them.
 */
@Global()
@Module({
  providers: [CustomerService, CustomerRepository],
  exports: [CustomerService],
})
export class CustomerModule {}
