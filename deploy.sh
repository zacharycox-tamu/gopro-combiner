#!/bin/bash

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
NAMESPACE="gopro-processor"
APP_NAME="gopro-video-processor"
IMAGE_NAME="gopro-video-processor"
IMAGE_TAG="latest"
DOMAIN="gopro.zephryn.io"

echo -e "${BLUE}🚀 Deploying GoPro Video Processor to Kubernetes${NC}"
echo "================================================="

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check required tools
echo -e "${YELLOW}📋 Checking prerequisites...${NC}"
for tool in kubectl docker; do
    if ! command_exists "$tool"; then
        echo -e "${RED}❌ $tool is not installed or not in PATH${NC}"
        exit 1
    fi
done
echo -e "${GREEN}✅ All prerequisites satisfied${NC}"

# Check if we can connect to Kubernetes
echo -e "${YELLOW}🔍 Checking Kubernetes connectivity...${NC}"
if ! kubectl cluster-info >/dev/null 2>&1; then
    echo -e "${RED}❌ Cannot connect to Kubernetes cluster${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Connected to Kubernetes cluster${NC}"

# Build Docker image
echo -e "${YELLOW}🏗️  Building Docker image...${NC}"
if ! docker build -t "${IMAGE_NAME}:${IMAGE_TAG}" .; then
    echo -e "${RED}❌ Docker build failed${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Docker image built successfully${NC}"

# Apply Kubernetes manifests
echo -e "${YELLOW}📦 Applying Kubernetes manifests...${NC}"

# Create namespace first
kubectl apply -f k8s/namespace.yaml

# Apply all other resources
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secret.yaml
kubectl apply -f k8s/persistent-volume.yaml
kubectl apply -f k8s/rbac.yaml
kubectl apply -f k8s/redis.yaml

# Wait for Redis to be ready
echo -e "${YELLOW}⏳ Waiting for Redis to be ready...${NC}"
kubectl wait --for=condition=available --timeout=300s deployment/redis -n "$NAMESPACE"

# Apply main application
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/ingress.yaml
kubectl apply -f k8s/hpa.yaml
kubectl apply -f k8s/network-policy.yaml
kubectl apply -f k8s/poddisruptionbudget.yaml
kubectl apply -f k8s/monitoring.yaml

echo -e "${GREEN}✅ All manifests applied${NC}"

# Wait for deployment to be ready
echo -e "${YELLOW}⏳ Waiting for deployment to be ready...${NC}"
kubectl wait --for=condition=available --timeout=600s deployment/gopro-processor -n "$NAMESPACE"

# Check pod status
echo -e "${YELLOW}📊 Checking pod status...${NC}"
kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=gopro-video-processor

# Get service information
echo -e "${YELLOW}🌐 Service information:${NC}"
kubectl get services -n "$NAMESPACE"

# Get ingress information
echo -e "${YELLOW}🔗 Ingress information:${NC}"
kubectl get ingress -n "$NAMESPACE"

# Final status
echo ""
echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
echo -e "${BLUE}📡 Application should be available at: https://$DOMAIN${NC}"
echo -e "${BLUE}🔍 Monitor deployment with: kubectl get pods -n $NAMESPACE -w${NC}"
echo -e "${BLUE}📄 Check logs with: kubectl logs -f deployment/gopro-processor -n $NAMESPACE${NC}"

# Show useful commands
echo ""
echo -e "${YELLOW}📝 Useful commands:${NC}"
echo "  View pods:     kubectl get pods -n $NAMESPACE"
echo "  View logs:     kubectl logs -f deployment/gopro-processor -n $NAMESPACE"
echo "  View services: kubectl get svc -n $NAMESPACE"
echo "  View ingress:  kubectl get ingress -n $NAMESPACE"
echo "  Scale app:     kubectl scale deployment gopro-processor --replicas=5 -n $NAMESPACE"
echo "  Port forward:  kubectl port-forward svc/gopro-processor-service 8080:80 -n $NAMESPACE"
