import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { Cassette, CassetteEntry } from './cassette';

/**
 * Persistence for a golden case's cassette, keyed by case id. One cassette per
 * {@link RehearsalCase}; the filesystem impl keeps them as inspectable JSON so
 * they can be reviewed and committed as behavioural fixtures. A DB-backed impl
 * can bind later without touching call sites.
 */
export interface CassetteStore {
  /** Load a case's cassette; an empty cassette when none has been recorded yet. */
  load(caseId: string): Promise<Cassette>;
  /** Persist a case's cassette (overwrites). */
  save(caseId: string, cassette: Cassette): Promise<void>;
}

/** JSON-file store: `<dir>/<caseId>.json`, an array of {@link CassetteEntry}. */
export class FileCassetteStore implements CassetteStore {
  constructor(private readonly dir: string) {}

  private path(caseId: string): string {
    if (!/^[\w.-]+$/.test(caseId)) throw new Error(`unsafe cassette case id: ${caseId}`);
    return join(this.dir, `${caseId}.json`);
  }

  async load(caseId: string): Promise<Cassette> {
    try {
      const raw = await fs.readFile(this.path(caseId), 'utf8');
      return new Cassette(JSON.parse(raw) as CassetteEntry[]);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return new Cassette();
      throw e;
    }
  }

  async save(caseId: string, cassette: Cassette): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.path(caseId), `${JSON.stringify(cassette.toJSON(), null, 2)}\n`, 'utf8');
  }
}

/** In-memory store — for tests and ephemeral runs. */
export class InMemoryCassetteStore implements CassetteStore {
  private readonly byCase = new Map<string, CassetteEntry[]>();

  async load(caseId: string): Promise<Cassette> {
    return new Cassette(this.byCase.get(caseId) ?? []);
  }

  async save(caseId: string, cassette: Cassette): Promise<void> {
    this.byCase.set(caseId, cassette.toJSON());
  }
}
