# GoPro Video Processor

A containerized web application for automatically detecting, grouping, and concatenating GoPro chaptered video files. Built with Node.js, React, FFmpeg, and designed for Kubernetes deployment.

![GoPro Video Processor](https://img.shields.io/badge/GoPro-Video%20Processor-blue?style=for-the-badge&logo=gopro)

## ✨ Features

- **🎥 Automatic GoPro File Detection**: Intelligently identifies and groups chaptered video files based on GoPro naming conventions
- **🔗 Lossless Video Concatenation**: Uses FFmpeg's concat demuxer for perfect quality preservation  
- **📤 Drag & Drop Upload**: Modern React interface with intuitive file upload
- **⚡ Real-time Progress**: WebSocket-based live updates during processing
- **🚀 Scalable Architecture**: Kubernetes-native with horizontal auto-scaling
- **📊 Queue Management**: Redis-backed job processing with BullMQ
- **🔒 Production Ready**: Security hardened with comprehensive monitoring

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   React Web     │    │  Node.js API    │    │ FFmpeg Workers  │
│   Frontend      │◄──►│    Server       │◄──►│   + BullMQ      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │                       │
                                ▼                       ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │ Redis Queue     │    │ Persistent      │
                       │ Management      │    │ Storage (PVC)   │
                       └─────────────────┘    └─────────────────┘
```

## 🚀 Quick Start

### Prerequisites

- Docker 20.10+
- Kubernetes 1.25+
- kubectl configured
- 100GB+ available storage for video processing

### One-Command Deployment

```bash
# Clone and deploy
git clone <repository>
cd gopro-video-processor
./deploy.sh
```

The application will be available at `https://gopro.zephryn.io`

### Local Development

```bash
# Start development environment
docker-compose up -d

# Install dependencies
npm install
cd frontend && npm install && cd ..

# Start backend
npm run dev

# Start frontend (new terminal)
cd frontend && npm start
```

## 📁 Project Structure

```
gopro-video-processor/
├── 📄 server.js                 # Node.js Express server
├── 📄 package.json              # Backend dependencies
├── 📄 Dockerfile               # Multi-stage container build
├── 📄 docker-compose.yml       # Local development setup
├── 📁 frontend/                # React application
│   ├── 📄 package.json         # Frontend dependencies  
│   ├── 📄 src/App.js           # Main React component
│   ├── 📄 src/App.css          # Styling
│   └── 📁 public/              # Static assets
├── 📁 k8s/                     # Kubernetes manifests
│   ├── 📄 namespace.yaml       # Namespace definition
│   ├── 📄 deployment.yaml      # Main application deployment
│   ├── 📄 service.yaml         # Kubernetes services
│   ├── 📄 ingress.yaml         # Ingress configuration
│   ├── 📄 configmap.yaml       # Configuration
│   ├── 📄 secret.yaml          # Secrets template
│   ├── 📄 redis.yaml           # Redis deployment
│   ├── 📄 hpa.yaml             # Horizontal Pod Autoscaler
│   ├── 📄 monitoring.yaml      # Prometheus monitoring
│   └── 📄 kustomization.yaml   # Kustomize configuration
├── 📄 deploy.sh                # Deployment script
└── 📄 cleanup.sh               # Cleanup script
```

## 🎯 How It Works

### 1. GoPro File Detection
The application automatically recognizes GoPro naming patterns:
- `GX010150.MP4` (Chapter 1, Sequence 150)
- `GX020150.MP4` (Chapter 2, Sequence 150)  
- `GX030150.MP4` (Chapter 3, Sequence 150)

### 2. Intelligent Grouping
Files are grouped by sequence number and encoding type, displaying:
- Total file count and size per group
- Chapter order verification
- Metadata analysis

### 3. Lossless Concatenation
Uses FFmpeg's concat demuxer for optimal results:
```bash
ffmpeg -f concat -safe 0 -i filelist.txt -c copy output.mp4
```

### 4. Real-time Processing
WebSocket connections provide live updates:
- Upload progress
- Processing stages  
- Completion notifications
- Error handling

## 🔧 Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection |
| `MAX_FILE_SIZE` | `10737418240` | Max upload size (10GB) |
| `FILE_RETENTION_HOURS` | `24` | File cleanup interval |
| `FFMPEG_THREADS` | `4` | FFmpeg thread count |
| `MAX_CONCURRENT_JOBS` | `3` | Concurrent processing limit |
| `LOG_LEVEL` | `info` | Logging level (error, warn, info, http, debug) |
| `LOG_DIR` | `logs` | Directory for log files |

### Kubernetes Configuration

Modify `k8s/configmap.yaml` to adjust settings:

```yaml
data:
  MAX_FILE_SIZE: "21474836480"  # 20GB
  FILE_RETENTION_HOURS: "48"   # 48 hours
  MAX_CONCURRENT_JOBS: "5"     # 5 concurrent jobs
```

## 📊 Monitoring & Logging

### Health Checks
- **Endpoint**: `/health`
- **Kubernetes**: Liveness and readiness probes configured
- **Metrics**: Prometheus metrics available at `/metrics`

### Logging

The application uses Winston for structured logging with configurable log levels:

**Log Levels** (from highest to lowest priority):
- `error` - Error messages only
- `warn` - Warnings and errors
- `info` - General information (default)
- `http` - HTTP request logs
- `debug` - Detailed debug information

**Enable Debug Logging:**
```bash
# Environment variable
export LOG_LEVEL=debug

# Docker
docker run -e LOG_LEVEL=debug ...

# Kubernetes (update configmap)
kubectl set env deployment/gopro-processor LOG_LEVEL=debug -n gopro-processor
```

**Log Output:**
- Console: Colored, human-readable format
- `logs/combined.log`: All logs in JSON format (rotated at 10MB, keeps 5 files)
- `logs/error.log`: Error logs only in JSON format (rotated at 10MB, keeps 5 files)

**Debug logging includes:**
- File upload details (names, sizes, types)
- GoPro file parsing and grouping
- FFmpeg command execution and output
- Job queue status and progress
- WebSocket connections and events
- API request/response details

**View Logs:**
```bash
# Local development
tail -f logs/combined.log | npx pino-pretty

# Kubernetes
kubectl logs -f deployment/gopro-processor -n gopro-processor

# With label selector
kubectl logs -f -l app=gopro-processor -n gopro-processor
```

### Observability
- **Logs**: Structured JSON logging with Winston
- **HTTP Logging**: Morgan middleware for request logging
- **Metrics**: Request rates, processing times, queue depths
- **Dashboards**: Grafana dashboard included
- **Alerts**: CPU, memory, and error rate monitoring

## 🔒 Security Features

- **Non-root Containers**: All containers run as unprivileged users
- **Network Policies**: Restricted pod-to-pod communication  
- **RBAC**: Minimal required permissions
- **TLS Encryption**: HTTPS with automatic cert management
- **File Validation**: Comprehensive input sanitization
- **Rate Limiting**: Request throttling and abuse prevention

## 🚀 Scaling

### Horizontal Pod Autoscaler
Automatically scales based on:
- CPU utilization (70% threshold)
- Memory utilization (80% threshold)  
- Custom metrics (queue depth)

```bash
# Manual scaling
kubectl scale deployment gopro-processor --replicas=10 -n gopro-processor
```

### Resource Limits
- **CPU**: 500m request, 2000m limit
- **Memory**: 2Gi request, 4Gi limit
- **Storage**: 100Gi persistent volume

## 🛠️ Development

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/upload` | Upload and detect GoPro files |
| `POST` | `/api/process` | Start video processing |
| `GET` | `/api/status/:sessionId` | Get processing status |
| `GET` | `/api/files/:sessionId` | List completed files |
| `GET` | `/api/download/:sessionId/:filename` | Download processed video |
| `GET` | `/health` | Health check endpoint |

### WebSocket Events

| Event | Description |
|-------|-------------|
| `job-progress` | Real-time processing updates |
| `job-complete` | Processing completion |
| `job-error` | Error notifications |

### Testing

```bash
# Backend tests
npm test

# Frontend tests  
cd frontend && npm test

# Integration tests
npm run test:integration

# Load testing
npm run test:load
```

## 🐳 Docker

### Build Image
```bash
docker build -t gopro-video-processor:latest .
```

### Run Locally
```bash
docker run -p 3000:3000 \
  -e REDIS_URL=redis://host.docker.internal:6379 \
  gopro-video-processor:latest
```

### Multi-architecture Build
```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t gopro-video-processor:latest .
```

## ☸️ Kubernetes Deployment

### Deploy to Cluster
```bash
# Quick deployment
./deploy.sh

# Manual deployment
kubectl apply -k k8s/

# Check status
kubectl get pods -n gopro-processor -w
```

### Access Application
```bash
# Port forward for testing
kubectl port-forward svc/gopro-processor-service 8080:80 -n gopro-processor

# View logs
kubectl logs -f deployment/gopro-processor -n gopro-processor
```

### Cleanup
```bash
./cleanup.sh
```

## 🔧 Troubleshooting

### Common Issues

**Upload fails with large files:**
```bash
# Increase nginx body size
kubectl patch configmap nginx-configuration -n ingress-nginx \
  --patch '{"data":{"proxy-body-size":"20g"}}'
```

**Processing jobs stuck:**
```bash
# Check Redis connection
kubectl exec -it deployment/redis -n gopro-processor -- redis-cli ping

# Restart processing pods
kubectl rollout restart deployment/gopro-processor -n gopro-processor
```

**Out of storage space:**
```bash
# Check PVC usage
kubectl exec -it deployment/gopro-processor -n gopro-processor -- df -h

# Clean up old files manually
kubectl exec -it deployment/gopro-processor -n gopro-processor -- \
  find /app/outputs -type f -mtime +1 -delete
```

### Logs Analysis
```bash
# Application logs (info level)
kubectl logs -f deployment/gopro-processor -n gopro-processor

# Enable debug logging temporarily
kubectl set env deployment/gopro-processor LOG_LEVEL=debug -n gopro-processor
kubectl logs -f deployment/gopro-processor -n gopro-processor

# Filter for errors only
kubectl logs deployment/gopro-processor -n gopro-processor | grep -i error

# Export logs to file
kubectl logs deployment/gopro-processor -n gopro-processor > gopro-logs.txt

# Redis logs  
kubectl logs -f deployment/redis -n gopro-processor

# Ingress logs
kubectl logs -f deployment/nginx-ingress-controller -n ingress-nginx
```

## 📈 Performance Optimization

### Resource Tuning
```yaml
# Increase CPU for faster processing
resources:
  requests:
    cpu: 1000m
    memory: 4Gi
  limits:
    cpu: 4000m
    memory: 8Gi
```

### Storage Optimization
- Use SSD-backed storage classes
- Consider NVMe for high-performance workloads
- Implement automatic cleanup policies

### Network Optimization
- Enable HTTP/2 in ingress
- Use connection pooling
- Implement caching strategies

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/awesome-feature`)
3. Commit changes (`git commit -am 'Add awesome feature'`)
4. Push to branch (`git push origin feature/awesome-feature`)
5. Create a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙋‍♂️ Support

- **Documentation**: Check this README and inline code comments
- **Issues**: Open a GitHub issue for bugs or feature requests
- **Discussions**: Use GitHub Discussions for questions and ideas

## 🏆 Acknowledgments

- **FFmpeg Team**: For the powerful video processing capabilities
- **GoPro**: For creating awesome cameras with predictable file naming
- **Kubernetes Community**: For the robust container orchestration platform
- **Open Source Contributors**: For the amazing libraries and tools used in this project

---

**Made with ❤️ for the GoPro community**
