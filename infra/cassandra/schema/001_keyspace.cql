-- One local node: SimpleStrategy, one copy. Production: NetworkTopologyStrategy, RF 3.
CREATE KEYSPACE IF NOT EXISTS chat
  WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};
