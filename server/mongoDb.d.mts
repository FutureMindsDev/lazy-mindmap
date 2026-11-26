export interface MongoDatabaseOptions {
  uri?: string;
  dbName?: string;
  firebaseAuth?: unknown;
  client?: unknown;
}

export function createMongoDatabase(options?: MongoDatabaseOptions): Record<string, any>;
