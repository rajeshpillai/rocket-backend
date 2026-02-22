export interface McpConfig {
  rocketUrl: string;
  email: string;
  password: string;
}

export function loadConfig(): McpConfig {
  const rocketUrl = process.env.ROCKET_URL || "http://localhost:8080";
  const email = process.env.ROCKET_EMAIL;
  const password = process.env.ROCKET_PASSWORD;

  if (!email || !password) {
    console.error(
      "ROCKET_EMAIL and ROCKET_PASSWORD environment variables are required"
    );
    process.exit(1);
  }

  return {
    rocketUrl: rocketUrl.replace(/\/+$/, ""),
    email,
    password,
  };
}
