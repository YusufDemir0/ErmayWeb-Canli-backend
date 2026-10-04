FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --legacy-peer-deps
RUN npx prisma generate

COPY . .

RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 backend

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY entrypoint.sh ./entrypoint.sh

RUN chmod +x ./entrypoint.sh && \
    mkdir -p /app/uploads/private /app/uploads/optimized && \
    chown -R backend:nodejs /app/uploads

USER backend

EXPOSE 5000

ENTRYPOINT ["./entrypoint.sh"]
