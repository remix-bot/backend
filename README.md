# TODO

# MySQL Setup

Required tables:
```SQL
CREATE TABLE `login_codes` (
  `user` varchar(26) COLLATE utf8mb4_general_ci NOT NULL,
  `id` varchar(50) COLLATE utf8mb4_general_ci NOT NULL,
  `token` varchar(70) COLLATE utf8mb4_general_ci NOT NULL,
  `verified` tinyint(1) NOT NULL DEFAULT '0',
  `createdAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE `login_codes`
  ADD UNIQUE KEY `login_codes_id` (`id`);

CREATE TABLE `api_tokens` (
  `user` varchar(26) COLLATE utf8mb4_general_ci NOT NULL,
  `id` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `token` varchar(70) CHARACTER SET utf8mb3 COLLATE utf8mb3_bin NOT NULL,
  `createdAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE `api_tokens`
  ADD UNIQUE KEY `api_token_index` (`id`);
```
