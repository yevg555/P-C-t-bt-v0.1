import winston from "winston";
import util from "util";

const { combine, timestamp, printf, colorize } = winston.format;

const myFormat = printf(({ level, message, timestamp, ...metadata }) => {
  // Get splat args
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const splatArgs = (metadata as any)[Symbol.for("splat")];

  // Format message using util.format if splat args exist
  // This handles both interpolation ("%s") and appending extra args
  let formattedMessage = message;
  if (splatArgs && splatArgs.length > 0) {
      formattedMessage = util.format(message, ...splatArgs);
  }

  return `${timestamp} [${level}]: ${formattedMessage}`;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: combine(
    colorize(),
    timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    // splat(), // Removed because we handle it manually in printf
    myFormat
  ),
  transports: [
    new winston.transports.Console()
  ],
});
