import { Injectable } from '@nestjs/common';
import { CustomerRepository } from './customer.repository';

/** The Customer aggregate: authenticated identities linked by verified email. */
@Injectable()
export class CustomerService {
  constructor(private readonly customers: CustomerRepository) {}

  upsertByEmail(args: { email: string; googleSub?: string; name?: string; role: string }) {
    return this.customers.upsertByEmail(args);
  }

  findById({ id }: { id: string }) {
    return this.customers.findById({ id });
  }
}
