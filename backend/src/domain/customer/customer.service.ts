import { Injectable } from '@nestjs/common';
import { DbTx } from '../../infra/persistence/prisma.service';
import { CustomerRepository } from './customer.repository';

/** The Customer aggregate: authenticated identities linked by verified email. */
@Injectable()
export class CustomerService {
  constructor(private readonly customers: CustomerRepository) {}

  upsertByEmail(args: { email: string; googleSub?: string; name?: string; role: string; tx?: DbTx }) {
    return this.customers.upsertByEmail(args);
  }

  findById({ id, tx }: { id: string; tx?: DbTx }) {
    return this.customers.findById({ id, tx });
  }
}
