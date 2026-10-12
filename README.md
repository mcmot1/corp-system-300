# Корпоративная система задач и внутреннего мессенджера

Серверный MVP корпоративной системы на NestJS + TypeScript + PostgreSQL + Socket.IO.
Системного ограничения на 100 сотрудников нет: пользователи хранятся в PostgreSQL без такого лимита. Значение `100` в пагинации означает размер одной страницы, а `MAX_CHAT_MEMBERS` ограничивает только размер одного группового чата (по умолчанию 500).

## Что реализовано

- JWT-подобные bearer-сессии с токенами в базе и хешированием паролей через scrypt.
- Роли администратора и сотрудника.
- Проекты и состав участников (`manager` / `member`).
- Задачи: статусы, приоритеты, исполнитель, срок, комментарии и журнал событий.
- Оптимистическая блокировка задач через поле `version`.
- Личные и групповые чаты.
- История сообщений с пагинацией, идемпотентная отправка по `client_id`, отметки прочтения.
- Socket.IO уведомление `message.created` после записи сообщения в PostgreSQL.
- Helmet, CORS allowlist, ограничения запросов, проверка входных данных Zod, параметризованные SQL-запросы.
- Docker Compose с PostgreSQL, API, React frontend и Caddy; API-порт наружу не публикуется.

## Запуск на VPS/VDS

1. Установите Docker Engine и Compose plugin.
2. Скопируйте проект на сервер и создайте `.env`:

```bash
cp .env.example .env
openssl rand -hex 24
nano .env
```

Укажите `DB_PASSWORD`, домен `DOMAIN` и точный адрес фронтенда в `CORS_ORIGINS`. Для 300 сотрудников оставьте `DB_POOL_MAX=20` и `MAX_CHAT_MEMBERS=500`.
DNS домена должен указывать на VPS; Caddy сам получит TLS-сертификат.

3. Запустите базу и сервер:

```bash
docker compose up -d --build
```

4. Создайте первого администратора (значения не сохраняются в файле проекта):

```bash
docker compose exec -e ADMIN_EMAIL=admin@example.com \
  -e ADMIN_PASSWORD='замените-на-длинный-пароль' \
  -e ADMIN_NAME='Администратор' api node dist/bootstrap.js
```

5. Проверка:

```bash
curl https://YOUR_DOMAIN/api/health
```

## Локальная проверка сервера

```bash
cd server
npm install
npm run build
DATABASE_URL='postgresql://corp:password@localhost:5432/corp' \
CORS_ORIGINS='http://localhost:3001' npm start
```

SQL-структура находится в `database/001_schema.sql`. Она выполняется автоматически только при первом создании пустого тома PostgreSQL. Для следующих изменений используйте новые миграции, а не редактируйте уже применённый файл.

## Основные API-маршруты

- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET/POST /api/users`, `PATCH /api/users/:id/active`
- `GET/POST /api/projects`
- `GET/POST /api/projects/:id/tasks`
- `PATCH /api/tasks/:id`, `GET/POST /api/tasks/:id/comments`
- `GET/POST /api/conversations`
- `GET/POST /api/conversations/:id/messages`
- `POST /api/conversations/:id/read`

Для защищённых маршрутов передавайте `Authorization: Bearer <access_token>`.
Socket.IO подключается с `auth: { token: access_token }`. Сервер выдаёт только события, адресованные участникам соответствующего чата.

Frontend находится в каталоге `frontend/`. Он содержит вход, проекты, задачи, мессенджер с Socket.IO и административный список пользователей. Для локальной разработки: `cd frontend && npm install && npm run dev`. В production frontend собирается автоматически контейнером `web` через Docker Compose.

Это серверный каркас и frontend MVP. Для промышленной эксплуатации дополнительно нужны резервное копирование PostgreSQL с проверкой восстановления, мониторинг, отдельное объектное хранилище для вложений, аудит действий и расширение ролей/прав доступа.

## Рекомендуемая схема эксплуатации для 300 сотрудников

- Ubuntu Server 24.04 LTS, Docker Engine и Compose plugin.
- 4 vCPU, 8 GB RAM, SSD от 80 GB для старта; PostgreSQL хранится на persistent volume.
- Caddy принимает только 80/443 и автоматически получает TLS; порт PostgreSQL не публикуется.
- Одного контейнера API достаточно для обычной нагрузки 300 сотрудников. При горизонтальном масштабировании добавьте Redis adapter для Socket.IO и внешний PostgreSQL.
- Делайте ежедневный `pg_dump` и регулярно проверяйте восстановление на отдельном каталоге.
