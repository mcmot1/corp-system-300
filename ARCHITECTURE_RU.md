# Вариант архитектуры корпоративной системы

## Выбор языка и базы данных

Для этой системы рекомендую **TypeScript на Node.js 24 LTS** с **NestJS**. TypeScript даёт типы на границе API, NestJS удобно разделяет модули авторизации, проектов, задач и сообщений, а Socket.IO обеспечивает realtime-уведомления в мессенджере. В приложенном архиве уже выбран этот стек; я его сохранил и адаптировал под 300 сотрудников.

Основная БД — **PostgreSQL 17**. В ней транзакции, внешние ключи, индексы, JSONB для журнала изменений и надёжная работа с одновременными изменениями задач. PostgreSQL не ограничивает систему 100 пользователями. Ограничение `100` в API — это максимальный размер страницы выдачи, а не число сотрудников.

Для одного VPS Redis не обязателен. Он понадобится, если API будет запущен в нескольких экземплярах: тогда Redis adapter синхронизирует Socket.IO между экземплярами. Файлы и вложения лучше хранить в S3-совместимом объектном хранилище, а не в PostgreSQL.

## Что входит в серверный код

- bearer-сессии с хешированием токенов и паролей;
- роли администратора и сотрудника;
- проекты и участники с ролями `manager`/`member`;
- задачи со статусом, приоритетом, сроком, исполнителем, комментариями и журналом;
- optimistic locking через `tasks.version`;
- личные и групповые чаты;
- пагинация истории сообщений и идемпотентная отправка через `client_id`;
- Socket.IO событие `message.created` только участникам чата;
- CORS allowlist, Helmet, rate limit, Zod validation и параметризованные SQL-запросы;
- Docker Compose: PostgreSQL + API + Caddy с TLS.

## Установка на Ubuntu Server 24.04

Ниже команды выполняются от пользователя с `sudo`.

```bash
sudo apt update
sudo apt install -y ca-certificates curl git openssl ufw

# Docker Engine и Compose plugin из официального репозитория Docker
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
printf '%s\n' \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu noble stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

Откройте только SSH, HTTP и HTTPS:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

Загрузите каталог проекта:

```bash
git clone <URL_ВАШЕГО_РЕПОЗИТОРИЯ> /opt/corp-system
cd /opt/corp-system
cp .env.example .env
nano .env
```

Минимальный `.env`:

```dotenv
DB_PASSWORD=<случайная_строка_из_openssl_rand_-hex_32>
DOMAIN=tasks.example.ru
CORS_ORIGINS=https://tasks.example.ru
MAX_CHAT_MEMBERS=500
DB_POOL_MAX=20
```

Сгенерировать пароль БД:

```bash
openssl rand -hex 32
```

До запуска убедитесь, что DNS-запись `tasks.example.ru` указывает на IP VPS. Затем:

```bash
docker compose up -d --build
docker compose ps
curl -fsS https://tasks.example.ru/api/health
```

Создайте первого администратора. Пароль не записывайте в `.env`:

```bash
docker compose exec \
  -e ADMIN_EMAIL=admin@example.ru \
  -e ADMIN_PASSWORD='длинный_пароль_не_короче_12_символов' \
  -e ADMIN_NAME='Администратор' \
  api node dist/bootstrap.js
```

Проверка логов:

```bash
docker compose logs -f --tail=200 api
```

## Резервная копия PostgreSQL

```bash
mkdir -p /opt/backups/corp
DB_CONTAINER=$(docker compose ps -q db)
docker exec "$DB_CONTAINER" pg_dump -U corp -d corp -Fc \
  > "/opt/backups/corp/corp-$(date +%F).dump"
find /opt/backups/corp -type f -mtime +14 -delete
```

Восстановление всегда сначала проверяйте в отдельной тестовой БД или на отдельном VPS. Не удаляйте production volume для проверки backup.

## Запуск frontend

В каталоге `frontend/` находится React + TypeScript интерфейс. Он содержит вход, проекты и задачи, смену статусов, мессенджер с Socket.IO и административный список пользователей.

Для локальной разработки:

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Для production frontend уже подключён в `compose.yaml` как сервис `web`, а Caddy направляет `/api` и `/socket.io` в API, остальные запросы — в frontend:

```bash
docker compose up -d --build
docker compose ps
```

Откройте `https://ваш-домен.ru`. Если backend и frontend размещены на разных доменах, укажите URL API в `frontend/.env` через `VITE_API_URL` и добавьте этот домен в `CORS_ORIGINS`.
