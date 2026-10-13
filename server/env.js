// Loaded first so every other module sees variables from .env.
try {
  process.loadEnvFile();
} catch {
  // No .env file — rely on the real environment.
}
