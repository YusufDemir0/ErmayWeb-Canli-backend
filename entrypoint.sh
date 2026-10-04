#!/bin/sh
set -e

echo "[Entrypoint] Veritabanı migrasyonları uygulanıyor..."
npx prisma migrate deploy

echo "[Entrypoint] Backend servisi başlatılıyor (PID 1)..."
exec node dist/server.js
