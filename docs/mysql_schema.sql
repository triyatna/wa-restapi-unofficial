CREATE TABLE IF NOT EXISTS wa_kv (
  `key` varchar(191) PRIMARY KEY,
  `value` json NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
