# --- Stage 1: Build the application (Generates the ./build directory) ---
# Use a Node 22 base image with development tools
FROM node:22-slim AS builder

# Set the working directory
WORKDIR /app

# Copy package files first to leverage Docker layer caching (faster builds if dependencies don't change)
COPY package*.json ./

# Install all dependencies, including devDependencies needed for 'tsc'
RUN npm install

# Copy the source code and configuration files
COPY . .

# Run the build command defined in package.json
# This command executes TypeScript compilation and outputs the files to ./build
RUN npm run build

# --- Stage 2: Create the final lightweight production image ---
# Start from a clean, slim Node 22 image for minimal size
FROM node:22-slim AS production

# Set working directory
WORKDIR /app

# Cloud Run requires the server to listen on the port specified by the PORT environment variable.
ENV PORT 8080

# Re-install only production dependencies (excluding devDependencies)
COPY package*.json ./
RUN npm install --omit=dev

# Copy the compiled JavaScript code from the builder stage
COPY --from=builder /app/build ./build

# Define the command to start the server
# The application must run the compiled index.js file
CMD [ "node", "build/index.js" ]
