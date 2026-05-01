FROM node:20-alpine AS builder

# Create app directory
WORKDIR /app

# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

# Install app dependencies
RUN npm ci

# Bundle app source
COPY . .

# Build the app
RUN npm run build

# ---

FROM node:20-alpine AS runner

WORKDIR /app

COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy the built app from the builder
COPY --from=builder /app/dist ./dist

# Create uploads dir just in case
RUN mkdir -p uploads

# Start the server
CMD ["npm", "run", "start:prod"]
