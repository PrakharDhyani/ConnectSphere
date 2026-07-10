# ConnectSphere 🌐

> A production-grade real-time video calling & collaboration platform.  
> Think Zoom + Snapchat filters + Figma whiteboard + mini-games — all in one browser tab.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + Tailwind CSS + Framer Motion |
| Backend | Node.js + Express |
| Real-time | Socket.io + mediasoup (WebRTC SFU) |
| Database | MongoDB + Mongoose |
| Cache / Pub-Sub | Redis |
| Event Streaming | Apache Kafka |
| Auth | JWT (access + refresh) + Google OAuth |
| Storage | AWS S3 |
| ML / Filters | TensorFlow.js + face-api.js + BodyPix |
| Containers | Docker + Docker Compose |
| Orchestration | Kubernetes (k8s) |
| CI/CD | GitHub Actions |
| Monitoring | Grafana + Prometheus + Winston logs |

---

## Features Roadmap

- **P0 MVP** — Auth, Dashboard, Room management, Video calls, Real-time Chat
- **P1 Core** — Collaborative Whiteboard, Face filters, Virtual backgrounds, Screen sharing
- **P2 Delight** — Mini-games, Call recording, Emoji reactions, Snapshots
- **P3 Polish** — Themes, PWA, Scheduling, Push notifications

---

## Local Development Setup

### Prerequisites
- Node.js 20+
- Docker + Docker Compose
- Git

### 1. Clone the repo
```bash
git clone https://github.com/YOUR_USERNAME/connectsphere.git
cd connectsphere
```

### 2. Set up environment variables
```bash
# The backend loads .env from its own working directory (dotenv/config
# resolves relative to process.cwd(), and you'll run `npm run dev` from
# inside backend/) — so the copy needs to land in backend/, not the repo root.
cp .env.example backend/.env
# Edit backend/.env and fill in your values
```

### 3. Start infrastructure (MongoDB + Redis + Kafka)
```bash
docker compose up -d mongo redis zookeeper kafka
```

### 4. Start backend
```bash
cd backend
npm install
npm run dev
```

### 5. Start frontend
```bash
cd frontend
npm install
npm run dev
```

Frontend → http://localhost:3000  
Backend API → http://localhost:5000  
API Health → http://localhost:5000/api/health

---

## Branch Strategy

```
main         ← production releases only
  └── develop  ← integration (all features merge here)
        └── feature/<name>   ← one branch per feature
        └── fix/<name>       ← bug fixes
        └── chore/<name>     ← config / tooling
```

### Commit convention
```
feat(scope): description
fix(scope): description
chore(scope): description
docs(scope): description
```

---

## Project Structure

```
connectsphere/
├── backend/          # Node.js + Express API
├── frontend/         # React + Vite SPA
├── k8s/              # Kubernetes manifests
├── .github/          # GitHub Actions CI + PR templates
├── docker-compose.yml
└── .env.example
```

---

## License

MIT
