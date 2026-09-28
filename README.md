# Phonebook App (Node.js)

Full-stack phonebook application with user accounts, contacts, tags, search, pagination, and CSV import/export.

## Tech Stack

- Node.js 20 + Express 4 (REST API)
- MongoDB 7 (native `mongodb` driver, no ORM)
- Vue.js 3 + Vite (frontend)
- NGINX (reverse proxy, serves frontend)
- Docker + Docker Compose
- Jest + Supertest (backend tests)

## Architecture

```text
Browser (:8080)
  ↓
NGINX (serves Vue frontend, proxies /api/*)
  ↓
Node.js + Express API (:8000 internal)
  ↓
MongoDB (phonebook_node database)
```

Docker services: `phonebook-nodejs` (API), `phonebook-node-db` (MongoDB, host :27019), `phonebook-node-frontend` (NGINX, host :8080).

## API

Auth uses an `HttpOnly` session cookie (`phonebook_session`).

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/auth/register` | Register + auto-login |
| POST | `/auth/login` | Login |
| GET | `/auth/me` | Current user |
| POST | `/auth/logout` | Logout |
| GET | `/contacts?page&limit&search&tag_ids` | List contacts (paginated, searchable) |
| POST | `/contacts` | Create contact |
| GET | `/contacts/{id}` | Get contact |
| PUT | `/contacts/{id}` | Update contact |
| DELETE | `/contacts/{id}` | Delete contact |
| GET | `/contacts/export` | Export contacts as CSV |
| POST | `/contacts/import` | Import contacts from CSV |
| GET/POST | `/tags` | List / create tags |
| PUT/DELETE | `/tags/{id}` | Rename / delete tag |

## Running

```bash
docker compose up --build
```

Open `http://localhost:8080`.

```bash
npm install
npm test
```
