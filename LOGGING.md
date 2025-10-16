# Logging Guide

## Overview

The GoPro Video Processor uses **Winston** for comprehensive logging with configurable log levels. This allows you to control the verbosity of logs based on your environment and debugging needs.

## Log Levels

From highest to lowest priority:

| Level | Description | Use Case |
|-------|-------------|----------|
| `error` | Error messages only | Production - critical issues only |
| `warn` | Warnings and errors | Production - potential problems |
| `info` | General information (default) | Production - normal operations |
| `http` | HTTP request logs | Development - API debugging |
| `debug` | Detailed debug information | Development - troubleshooting |

## Quick Start

### Enable Debug Logging Locally

```bash
# Set environment variable
export LOG_LEVEL=debug

# Start the server
npm run dev
```

### Enable Debug Logging in Docker

```bash
docker run -e LOG_LEVEL=debug gopro-video-processor:latest
```

### Enable Debug Logging in Kubernetes

```bash
# Temporary (restarts deployment)
kubectl set env deployment/gopro-processor LOG_LEVEL=debug -n gopro-processor

# Permanent (update configmap)
kubectl edit configmap gopro-processor-config -n gopro-processor
# Change LOG_LEVEL: "debug" in the data section
kubectl rollout restart deployment/gopro-processor -n gopro-processor
```

## What Gets Logged

### Info Level (Default)
- Application startup and configuration
- File upload requests
- Job creation and completion
- WebSocket connections
- API endpoint access
- Server lifecycle events

### Debug Level (Detailed)
All of the above, plus:
- Individual file parsing details
- GoPro filename detection results
- File grouping logic
- Session directory creation
- FFmpeg command construction
- FFmpeg output streaming
- Job progress updates
- Input file verification
- Directory creation/checks
- Health check details
- All request/response payloads

## Log Files

Logs are written to both console and files:

### Console Output
- **Format**: Colored, human-readable
- **Timestamp**: `YYYY-MM-DD HH:mm:ss:ms`
- **Includes**: All configured log levels

### File Output
Located in the `logs/` directory (configurable via `LOG_DIR` environment variable):

#### `logs/combined.log`
- **Format**: JSON (structured)
- **Contains**: All log levels
- **Rotation**: 10MB max size, keeps 5 files
- **Use**: General log analysis, searching

#### `logs/error.log`
- **Format**: JSON (structured)
- **Contains**: Error level only
- **Rotation**: 10MB max size, keeps 5 files
- **Use**: Quick error identification

## Example Logs

### Info Level Log
```
2024-01-15 10:30:45:123 [info]: Upload request received {"sessionId":"abc-123","fileCount":3,"ip":"127.0.0.1"}
```

### Debug Level Log
```
2024-01-15 10:30:45:124 [debug]: Parsed GoPro filename {
  "filename": "GX010150.MP4",
  "parsed": {
    "encoding": "X",
    "chapter": 1,
    "sequence": 150,
    "extension": "MP4",
    "isGoPro": true
  }
}
```

### Error Log
```
2024-01-15 10:30:50:456 [error]: Error occurred {
  "message": "FFmpeg failed with code 1",
  "stack": "Error: FFmpeg failed...",
  "name": "Error",
  "jobId": "job-456",
  "sessionId": "abc-123"
}
```

## Viewing Logs

### Local Development

```bash
# Follow all logs
tail -f logs/combined.log

# Follow errors only
tail -f logs/error.log

# Pretty print JSON logs (requires pino-pretty)
tail -f logs/combined.log | npx pino-pretty

# Search logs
grep "Upload request" logs/combined.log

# Watch logs with color
npm install -g pino-pretty
tail -f logs/combined.log | pino-pretty
```

### Kubernetes

```bash
# Follow pod logs
kubectl logs -f deployment/gopro-processor -n gopro-processor

# Get all logs
kubectl logs deployment/gopro-processor -n gopro-processor

# Get logs from specific pod
kubectl logs gopro-processor-abc123-xyz -n gopro-processor

# Get logs with timestamps
kubectl logs --timestamps=true deployment/gopro-processor -n gopro-processor

# Filter for errors
kubectl logs deployment/gopro-processor -n gopro-processor | grep ERROR

# Save to file
kubectl logs deployment/gopro-processor -n gopro-processor > app.log
```

## Troubleshooting with Logs

### Problem: Upload fails
```bash
# Enable debug logging
export LOG_LEVEL=debug

# Look for:
# - "File type rejected" warnings
# - "No files uploaded" warnings
# - File size validation errors
tail -f logs/combined.log | grep -i upload
```

### Problem: Processing stuck
```bash
# Look for:
# - Job queue status
# - FFmpeg errors
# - Input file verification failures
tail -f logs/combined.log | grep -E "job|ffmpeg"
```

### Problem: Performance issues
```bash
# Enable http logging
export LOG_LEVEL=http

# Look for:
# - Slow API responses
# - High request rates
# - Large file transfers
tail -f logs/combined.log | grep -i "ms\|time"
```

## Best Practices

### Development
- **Use**: `LOG_LEVEL=debug`
- **Why**: Get detailed information for debugging
- **Tip**: Pipe through `pino-pretty` for readable output

### Staging
- **Use**: `LOG_LEVEL=http`
- **Why**: See all requests while testing
- **Tip**: Monitor for performance issues

### Production
- **Use**: `LOG_LEVEL=info` (default)
- **Why**: Balance between information and performance
- **Tip**: Ship logs to centralized logging system

### Emergency Debug
- **Use**: Temporarily set `LOG_LEVEL=debug` on specific pods
- **Why**: Diagnose production issues without affecting all instances
- **Tip**: Remember to revert after debugging

## Integration with Monitoring

### Structured JSON Logs

All file logs are in JSON format for easy parsing:

```json
{
  "timestamp": "2024-01-15 10:30:45:123",
  "level": "info",
  "message": "Upload request received",
  "sessionId": "abc-123",
  "fileCount": 3,
  "ip": "127.0.0.1"
}
```

### Log Aggregation

Ship logs to your preferred system:

**Elasticsearch + Kibana**
```bash
# Use Filebeat to ship logs
filebeat -e -c filebeat.yml
```

**Datadog**
```bash
# Use Datadog agent
DD_API_KEY=xxx npm start
```

**CloudWatch**
```bash
# Use awslogs driver in Kubernetes
# Configure in deployment.yaml
```

## Performance Considerations

- Debug logging **can impact performance** due to increased I/O
- Use `LOG_LEVEL=info` or `LOG_LEVEL=warn` in production
- Log files rotate automatically at 10MB to prevent disk space issues
- Consider disabling file logging in high-throughput scenarios

## Environment Variables

```bash
# Set log level
LOG_LEVEL=debug

# Set custom log directory
LOG_DIR=/var/log/gopro-processor

# Both together
LOG_LEVEL=debug LOG_DIR=/custom/path npm start
```

## Common Log Patterns

### Successful Upload Flow
```
[info]: Upload request received
[debug]: Processing uploaded file
[debug]: File type accepted
[debug]: Parsed GoPro filename
[debug]: Creating new group
[debug]: Added file to group
[info]: File grouping complete
[info]: Upload successful
```

### Successful Processing Flow
```
[info]: Process request received
[debug]: Adding job to queue
[info]: Job queued
[info]: Job started processing
[debug]: Verifying input files exist
[debug]: Preparing output directory
[info]: Starting video concatenation
[debug]: Spawning FFmpeg process
[debug]: FFmpeg progress
[info]: Video concatenation successful
[info]: Job completed successfully
```

## Support

For more information:
- See main [README.md](README.md) for general documentation
- Check [Winston documentation](https://github.com/winstonjs/winston) for advanced configuration
- Open an issue for logging-related bugs

