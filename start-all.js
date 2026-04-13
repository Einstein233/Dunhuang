const { spawn } = require("child_process");
const path = require("path");

const colors = {
  reset: "\x1b[0m",
  title: "\x1b[35m",
  docker: "\x1b[36m",
  weather: "\x1b[33m",
  front: "\x1b[32m",
  back: "\x1b[34m",
  error: "\x1b[31m"
};

const dockerConfig = {
  name: "sql-agent(docker)",
  cwd: path.join(__dirname, "sql-agent"),
  command: "docker",
  upArgs: ["compose", "up", "-d", "--build"],
  downArgs: ["compose", "down"],
  color: colors.docker
};

const nodeServices = [
  {
    name: "WeatherVisualization",
    cwd: path.join(__dirname, "WeatherVisualization"),
    command: "npm",
    args: ["run", "dev"],
    color: colors.weather
  },
  {
    name: "front_con",
    cwd: path.join(__dirname, "front_con"),
    command: "npm",
    args: ["run", "dev"],
    color: colors.front
  },
  {
    name: "back_con",
    cwd: path.join(__dirname, "back_con"),
    command: "npm",
    args: ["run", "dev"],
    color: colors.back
  }
];

const runningChildren = [];
let shuttingDown = false;

function log(color, message) {
  console.log(`${color}${message}${colors.reset}`);
}

function spawnLongRunning(service) {
  log(service.color, `[${service.name}] starting...`);

  const child = spawn(service.command, service.args, {
    cwd: service.cwd,
    shell: true,
    env: { ...process.env }
  });

  child.stdout.on("data", (data) => {
    process.stdout.write(`${service.color}[${service.name}]${colors.reset} ${data}`);
  });

  child.stderr.on("data", (data) => {
    process.stderr.write(`${service.color}[${service.name}]${colors.reset} ${data}`);
  });

  child.on("close", (code) => {
    log(service.color, `[${service.name}] exited with code: ${code}`);
  });

  runningChildren.push(child);
}

function runShortCommand(name, cwd, command, args, color) {
  return new Promise((resolve, reject) => {
    log(color, `[${name}] ${command} ${args.join(" ")}`);

    const child = spawn(command, args, {
      cwd,
      shell: true,
      env: { ...process.env }
    });

    child.stdout.on("data", (data) => {
      process.stdout.write(`${color}[${name}]${colors.reset} ${data}`);
    });

    child.stderr.on("data", (data) => {
      process.stderr.write(`${color}[${name}]${colors.reset} ${data}`);
    });

    child.on("error", reject);
    child.on("close", (code) => resolve(code));
  });
}

async function startAll() {
  log(colors.title, "========================================");
  log(colors.title, "Starting all services...");
  log(colors.title, "========================================");

  const dockerUpCode = await runShortCommand(
    dockerConfig.name,
    dockerConfig.cwd,
    dockerConfig.command,
    dockerConfig.upArgs,
    dockerConfig.color
  );

  if (dockerUpCode !== 0) {
    log(colors.error, "[start-all] docker compose up failed, startup aborted.");
    process.exit(1);
  }

  nodeServices.forEach(spawnLongRunning);

  log(colors.title, "");
  log(colors.title, "All services started.");
  log(colors.title, "front_con:             http://127.0.0.1:2023");
  log(colors.title, "back_con:              http://127.0.0.1:3000");
  log(colors.title, "sql-agent ui/api:      http://127.0.0.1:3001");
  log(colors.title, "mysql (docker):        127.0.0.1:3308");
  log(colors.title, "Press Ctrl+C to stop all services.");
  log(colors.title, "");
}

async function shutdownAll() {
  if (shuttingDown) return;
  shuttingDown = true;

  log(colors.title, "\nStopping all services...");

  runningChildren.forEach((child) => {
    try {
      child.kill();
    } catch (error) {
      log(colors.error, `[start-all] failed to stop child process: ${error.message}`);
    }
  });

  try {
    await runShortCommand(
      dockerConfig.name,
      dockerConfig.cwd,
      dockerConfig.command,
      dockerConfig.downArgs,
      dockerConfig.color
    );
  } catch (error) {
    log(colors.error, `[start-all] docker compose down failed: ${error.message}`);
  }

  process.exit(0);
}

process.on("SIGINT", shutdownAll);
process.on("SIGTERM", shutdownAll);

startAll().catch((error) => {
  log(colors.error, `[start-all] startup failed: ${error.message}`);
  process.exit(1);
});
