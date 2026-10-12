-- PostgreSQL 17+. Run once against an empty application database.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 email text NOT NULL UNIQUE CHECK (email=lower(email)),
 display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 120),
 password_hash text NOT NULL,
 role text NOT NULL DEFAULT 'employee' CHECK(role IN ('admin','employee')),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE projects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 description text NOT NULL DEFAULT '',
 owner_id uuid NOT NULL REFERENCES users(id),
 archived boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE project_members (
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id),
 role text NOT NULL CHECK(role IN ('manager','member')),
 PRIMARY KEY(project_id,user_id)
);
CREATE INDEX project_members_user_idx ON project_members(user_id,project_id);
CREATE TABLE tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES projects(id),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 250),
 description text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in_progress','review','done','cancelled')),
 priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
 creator_id uuid NOT NULL REFERENCES users(id),
 assignee_id uuid,
 due_at timestamptz,
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(project_id,assignee_id) REFERENCES project_members(project_id,user_id)
);
CREATE INDEX tasks_project_idx ON tasks(project_id,created_at DESC,id DESC);
CREATE INDEX tasks_assignee_idx ON tasks(assignee_id,status,due_at);
CREATE TABLE task_comments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 author_id uuid NOT NULL REFERENCES users(id),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 10000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_task_idx ON task_comments(task_id,created_at,id);
CREATE TABLE task_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 task_id uuid NOT NULL REFERENCES tasks(id),
 actor_id uuid NOT NULL REFERENCES users(id),
 action text NOT NULL,
 data jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_events_task_idx ON task_events(task_id,id);
CREATE TABLE conversations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 kind text NOT NULL CHECK(kind IN ('direct','group')),
 creator_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE conversation_members (
 conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id),
 PRIMARY KEY(conversation_id,user_id)
);
CREATE INDEX conversation_members_user_idx ON conversation_members(user_id,conversation_id);
CREATE TABLE messages (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 conversation_id uuid NOT NULL REFERENCES conversations(id),
 sender_id uuid NOT NULL REFERENCES users(id),
 client_id uuid NOT NULL,
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 10000),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(conversation_id,sender_id,client_id)
);
CREATE INDEX messages_history_idx ON messages(conversation_id,id DESC);
CREATE TABLE message_reads (
 conversation_id uuid NOT NULL,
 user_id uuid NOT NULL,
 last_message_id bigint NOT NULL REFERENCES messages(id),
 PRIMARY KEY(conversation_id,user_id),
 FOREIGN KEY(conversation_id,user_id) REFERENCES conversation_members(conversation_id,user_id)
);
CREATE TABLE schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
INSERT INTO schema_migrations(version) VALUES(1);
COMMIT;
