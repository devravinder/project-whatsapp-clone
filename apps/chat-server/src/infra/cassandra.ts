import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import cassandra from "cassandra-driver";
import { APP_CONFIG, type AppConfig } from "../config.js";

@Injectable()
export class CassandraService implements OnModuleDestroy {
  readonly client: cassandra.Client;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    // Connects lazily on the first query, so the server starts even if Cassandra is still booting.
    this.client = new cassandra.Client({
      contactPoints: config.CASSANDRA_CONTACT_POINTS,
      localDataCenter: config.CASSANDRA_LOCAL_DC,
      keyspace: config.CASSANDRA_KEYSPACE,
    });
  }

  async ping(): Promise<string> {
    const result = await this.client.execute("SELECT release_version FROM system.local");
    return `cassandra ${result.first().get("release_version")}`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.shutdown();
  }
}
