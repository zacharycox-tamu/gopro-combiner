#!/bin/bash

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

NAMESPACE="gopro-processor"

echo -e "${BLUE}🧹 Cleaning up GoPro Video Processor deployment${NC}"
echo "================================================="

# Warning
echo -e "${YELLOW}⚠️  WARNING: This will delete all resources in the $NAMESPACE namespace${NC}"
read -p "Are you sure you want to continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${BLUE}Operation cancelled${NC}"
    exit 0
fi

echo -e "${YELLOW}🗑️  Deleting resources...${NC}"

# Delete in reverse order
kubectl delete -f k8s/monitoring.yaml --ignore-not-found=true
kubectl delete -f k8s/poddisruptionbudget.yaml --ignore-not-found=true
kubectl delete -f k8s/network-policy.yaml --ignore-not-found=true
kubectl delete -f k8s/hpa.yaml --ignore-not-found=true
kubectl delete -f k8s/ingress.yaml --ignore-not-found=true
kubectl delete -f k8s/service.yaml --ignore-not-found=true
kubectl delete -f k8s/deployment.yaml --ignore-not-found=true
kubectl delete -f k8s/redis.yaml --ignore-not-found=true
kubectl delete -f k8s/rbac.yaml --ignore-not-found=true
kubectl delete -f k8s/persistent-volume.yaml --ignore-not-found=true
kubectl delete -f k8s/secret.yaml --ignore-not-found=true
kubectl delete -f k8s/configmap.yaml --ignore-not-found=true

# Wait for pods to terminate
echo -e "${YELLOW}⏳ Waiting for pods to terminate...${NC}"
kubectl wait --for=delete pods --all -n "$NAMESPACE" --timeout=120s || true

# Delete namespace
kubectl delete -f k8s/namespace.yaml --ignore-not-found=true

echo -e "${GREEN}✅ Cleanup completed${NC}"

# Clean up Docker images (optional)
read -p "Do you want to remove Docker images as well? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}🗑️  Removing Docker images...${NC}"
    docker rmi gopro-video-processor:latest 2>/dev/null || true
    echo -e "${GREEN}✅ Docker images cleaned up${NC}"
fi

echo -e "${BLUE}🎉 All resources have been cleaned up${NC}"
