# Talentflow Resume Intelligence

Talentflow is a private resume import and review application. It accepts PDF, DOCX, JPG, JPEG, and PNG files, extracts candidate details, flags records for review, detects duplicates, and exports results to Excel.

The application has three runtime services:

1. **Web app** — Next.js UI and authenticated API at `http://localhost:3000`.
2. **PostgreSQL** — stores users, resume metadata, extracted fields, batches, and audit records.
3. **Redis and worker** — BullMQ uses Redis as a queue; a separate Node.js worker reads files from private storage and performs parsing/OCR.

Resume contents are stored under private storage and are not served from `public/`. The worker must be running for uploaded resumes to move from `PENDING` to `COMPLETED` or `REVIEW`.

## Requirements

### With Docker (recommended)

- Docker Desktop with Docker Compose v2
- At least 4 GB RAM available to Docker for dependency setup and OCR

### Running services locally

- Node.js 22 or newer (the Docker image uses Node 22)
- npm (the version bundled with Node.js)
- PostgreSQL 16
- Redis 7
- Windows, macOS, or Linux; Tesseract.js uses its English language data, downloaded on first OCR use unless `TESSDATA_PATH` points to a local language-data directory

## Configuration

Create a local environment file from the example:

```powershell
Copy-Item .env.example .env
```

Set `AUTH_SECRET` to a unique secret of at least 32 characters. Generate a bcrypt hash for the initial administrator password:

```powershell
node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 12))" "choose-a-long-password"
```

Set `SEED_ADMIN_EMAIL` to the administrator email and `SEED_ADMIN_PASSWORD_HASH` to the generated hash. The seed command writes the administrator account into PostgreSQL. These two seed variables are only used when running the seed command; login checks the stored user record. Keep `.env` private and do not commit it.

### Environment variables

| Variable | Purpose | Example/default |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@localhost:5432/talentflow?schema=public` |
| `REDIS_URL` | Redis connection string used by web and worker | `redis://localhost:6379` |
| `AUTH_SECRET` | Signs administrator sessions | Replace the example with a random secret (32+ characters) |
| `SEED_ADMIN_EMAIL` | Initial administrator email for database seeding | `admin@example.com` |
| `SEED_ADMIN_PASSWORD_HASH` | bcrypt hash used by database seeding | Generate as above |
| `STORAGE_PATH` | Private directory for uploaded files | `./private-uploads` locally; `/app/private-uploads` in Docker |
| `MAX_FILE_SIZE` | Maximum size per uploaded file, in bytes | `20971520` (20 MiB) |
| `MAX_UPLOAD_BATCH_BYTES` | Maximum total size per upload request, in bytes | `78643200` (75 MiB) |
| `WORKER_CONCURRENCY` | Number of resumes a worker processes concurrently | `3` in `.env.example`; `5` if unset |
| `CONFIDENCE_THRESHOLD` | Minimum overall extraction confidence, as a percent from 0 to 100 | `75` |
| `AI_PROVIDER` | Optional provider label passed to the configured AI endpoint | unset (disabled) |
| `AI_API_URL` | Optional AI parsing endpoint | unset (disabled) |
| `AI_API_KEY` | Optional bearer token for the AI endpoint | unset (disabled) |
| `TESSDATA_PATH` | Optional path to local Tesseract language data | unset (Tesseract.js downloads English data on first use) |

The optional AI adapter only assists with low-confidence name and designation extraction. Its request includes resume text; configure it only with a provider approved to process that data. Parsing continues without AI when these settings are absent.

Remote AI now also requires explicit `AI_PARSING_ENABLED=true`. It is disabled by default, including when provider credentials are present.

See [M1 worker reliability](docs/M1-worker-reliability.md) for migration rollout, processing ownership, queue recovery, batch accounting, isolated database tests, and outage verification.

See [M2 candidate data](docs/M2-candidate-data.md) for structured candidate models, validated persistence APIs, private provenance, compatibility, migration rollout, and database tests.

## Run with Docker Compose

1. Complete the configuration above and make sure `.env` exists.
2. Build and start the services:

   ```powershell
   docker compose up
   ```

   Compose starts PostgreSQL and Redis, installs dependencies and generates Prisma Client in the setup service, applies database migrations, then runs the web app and worker. The web service is available at `http://localhost:3000`.

3. In another terminal, create the initial administrator account:

   ```powershell
   docker compose exec web npm run db:seed
   ```

4. Sign in at `http://localhost:3000/login` using `SEED_ADMIN_EMAIL` and the original password used to generate `SEED_ADMIN_PASSWORD_HASH`.
5. Open **Import resumes** to upload files. Check **Processing batches** and the worker terminal/logs to follow progress.

Stop the services with `Ctrl+C`. Start them again with `docker compose up`. To run them in the background, use `docker compose up -d`; view logs with `docker compose logs -f web worker`, and stop them with `docker compose down`. `docker compose down -v` also deletes the PostgreSQL, Redis, dependency, and upload volumes; use it only when you intend to discard that data.

## Run services locally

Use this when Node.js is installed on the host and PostgreSQL/Redis are available locally. Keep the `.env` connection URLs pointed at those services (`localhost` for a locally installed database and Redis).

1. Start PostgreSQL and Redis. To use the included Compose containers just for these dependencies:

   ```powershell
   docker compose up -d postgres redis
   ```

2. Install dependencies and generate Prisma Client:

   ```powershell
   npm ci
   npm run db:generate
   ```

3. Apply migrations and create the administrator and sample records:

   ```powershell
   npm run db:deploy
   npm run db:seed
   ```

   Seeding is intended for a development database. It creates five synthetic resume records in different states and copies test fixtures into private storage. Rerunning it can reset the configured administrator password.

4. Start the web app in terminal 1:

   ```powershell
   npm run dev
   ```

5. Start the background worker in terminal 2:

   ```powershell
   npm run worker
   ```

6. Sign in at `http://localhost:3000/login`, then import resumes. Leave both web and worker processes running while the app is in use.

For a production build, use `npm run build` and then `npm start` for the web process. Run the worker separately with `npm run worker`; do not rely on the development server to process the queue.

## Typical workflow

1. Sign in as the administrator.
2. Import files from **Import resumes**. Supported formats are PDF, DOCX, JPG, JPEG, and PNG. The UI supports logical batches of 100, 500, 1,000, or 5,000 files, uploaded in requests of at most 50 files and 75 MiB. The default per-file size limit is 20 MiB.
3. The upload endpoint saves files in private storage and adds jobs to BullMQ. The worker extracts PDF/DOCX text or OCRs images and scanned PDFs, then extracts email, phone, name, and designation.
4. Check **Processing batches** for progress. A `PENDING` record means it is waiting for a worker. A `PROCESSING` record is being handled. `COMPLETED` records passed the review threshold; `REVIEW` records need manual review; `FAILED` records exhausted processing attempts; and `DUPLICATE` records matched an existing candidate or file.
5. Review flagged records in **Review queue** or open a record from **All resumes**. Save corrected fields from the resume detail page.
6. Download an Excel export from **Export**.

If uploaded records stay `PENDING`, confirm Redis is reachable and `npm run worker` (or the Compose worker service) is running. The **Start processing** control on **Processing batches** requeues pending records. A failed resume can be retried from its detail page or through the failed-processing controls.

## npm commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start Next.js development server |
| `npm run build` | Create the production web build |
| `npm start` | Start the production web server after building |
| `npm run worker` | Start the BullMQ resume-processing worker |
| `npm run db:generate` | Generate Prisma Client |
| `npm run db:migrate` | Create/apply a development migration with Prisma |
| `npm run db:deploy` | Apply committed migrations (deployment flow) |
| `npm run db:seed` | Seed administrator and development sample resumes |
| `npm run lint` | Run ESLint |
| `npm test` | Run the Vitest test suite |
| `npx tsc --noEmit` | Type-check TypeScript files |

## Main dependencies

Runtime dependencies include Next.js 16, React 19, Prisma 7 with PostgreSQL (`pg` and `@prisma/adapter-pg`), BullMQ and ioredis, `pdf-parse` for PDF text and page rendering, Mammoth for DOCX text, Tesseract.js for OCR, `libphonenumber-js` for phone normalization, Zod for validation, ExcelJS for spreadsheet exports, and `jose`/`bcryptjs` for session and password handling. Development dependencies include TypeScript, ESLint, Vitest, `tsx`, Prisma CLI, and Tailwind CSS 4.

`package.json` and `package-lock.json` are the source of truth for exact package versions. `npm ci` installs the lockfile versions.

## Pages and API

Main pages: `/login`, `/`, `/import`, `/resumes`, `/resumes/[id]`, `/review`, `/duplicates`, `/failed`, `/batches`, `/export`, and `/settings`.

Important API routes include `POST /api/resumes/upload`, `GET /api/resumes`, `GET/PATCH /api/resumes/[id]`, `POST /api/resumes/[id]/retry`, `GET /api/dashboard/stats`, `GET /api/batches`, `POST /api/processing/start|pause|resume`, and `GET /api/export?status=ALL|COMPLETED|REVIEWED|REVIEW|FAILED`. Workspace pages and admin routes require the HttpOnly administrator session cookie. There is no public registration flow.

## Data, troubleshooting, and deployment notes

- **Worker exits while OCRing a scanned PDF:** restart with the current code; scanned PDFs are rendered to PNG pages before being passed to Tesseract. Check worker logs for subsequent parsing errors.
- **OCR first run is slow or has no language data:** allow Tesseract.js to download its English data, or set `TESSDATA_PATH` to an existing English trained-data directory.
- **Database connection errors:** check `DATABASE_URL`, confirm PostgreSQL is listening, and run `npm run db:deploy`.
- **Queue connection errors or pending work:** check `REDIS_URL`, confirm Redis is listening, and ensure the worker is running.
- **Uploaded file cannot be opened:** confirm `STORAGE_PATH` is persistent and shared by web and worker processes. Docker Compose uses a shared `uploads` volume.
- **Security:** keep `.env`, private uploads, and database backups protected. In production use TLS, persistent PostgreSQL/Redis, encrypted private file storage, backups, and monitoring for worker/queue failures. Consider private object storage for multi-host deployments. Do not log resume text or expose the upload directory publicly.

Automated tests cover deterministic field extraction, duplicate matching, PDF/DOCX parsing, malformed files, and Excel generation. Use a non-production database for any integration or deployment checks.
