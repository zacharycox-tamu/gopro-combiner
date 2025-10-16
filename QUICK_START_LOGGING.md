# Quick Start - Debug Logging

## TL;DR

```bash
# Install dependencies
npm install

# Run with debug logging
npm run dev:debug

# View logs
tail -f logs/combined.log
```

## Common Commands

### Development

```bash
# Normal logging (info level)
npm run dev

# Debug logging (detailed)
npm run dev:debug

# HTTP logging (request tracking)
npm run dev:http

# Custom level
LOG_LEVEL=warn npm run dev
```

### View Logs

```bash
# Watch all logs
tail -f logs/combined.log

# Watch errors only
tail -f logs/error.log

# Search logs
findstr "error" logs\combined.log    # Windows
grep "error" logs/combined.log        # Linux/Mac
```

### Docker

```bash
# Run with debug logging
docker run -e LOG_LEVEL=debug -p 3000:3000 gopro-video-processor

# View container logs
docker logs -f container_name
```

### Kubernetes

```bash
# Enable debug logging
kubectl set env deployment/gopro-processor LOG_LEVEL=debug -n gopro-processor

# View logs
kubectl logs -f deployment/gopro-processor -n gopro-processor

# Disable debug logging
kubectl set env deployment/gopro-processor LOG_LEVEL=info -n gopro-processor
```

## Log Levels

| Level | When to Use |
|-------|-------------|
| `debug` | 🔍 Development & troubleshooting |
| `http` | 🌐 API debugging |
| `info` | ✅ Normal production (default) |
| `warn` | ⚠️ Production with warnings |
| `error` | ❌ Production - errors only |

## What You'll See

### Info Level (Default)
- Application startup
- File uploads
- Job processing
- API requests
- Completions/errors

### Debug Level (Detailed)
All of the above, PLUS:
- Individual file processing
- GoPro filename parsing
- FFmpeg commands & output
- Job queue events
- Directory creation
- WebSocket events
- Request/response details

## Files Created

- `logs/combined.log` - All logs (JSON format)
- `logs/error.log` - Errors only (JSON format)
- Console output - Colored, human-readable

## Need Help?

- Full docs: [LOGGING.md](LOGGING.md)
- Summary: [DEBUG_LOGGING_SUMMARY.md](DEBUG_LOGGING_SUMMARY.md)
- Main docs: [README.md](README.md)

