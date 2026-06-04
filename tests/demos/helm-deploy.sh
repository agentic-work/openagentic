#!/usr/bin/env bash
# openagentic — helm install onto a k3s cluster, images from in-cluster Harbor.
# Prereq (once): images built + pushed to harbor.agenticwork.io/openagentic/*:1.0.0,
# and helm/openagentic/values-local-k8s.yaml filled in (registry, secrets, ollama, bedrock).
set -euo pipefail
NS=openagentic
kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f -
# pull secret so k3s can pull the private OSS images from Harbor
kubectl get secret harbor-creds -n "$NS" >/dev/null 2>&1 || \
  kubectl create secret docker-registry harbor-creds -n "$NS" \
    --docker-server=harbor.agenticwork.io --docker-username=admin --docker-password="$HARBOR_PASS"
helm upgrade --install openagentic ./helm/openagentic -n "$NS" \
  -f helm/openagentic/values-local-k8s.yaml --wait --timeout 12m
kubectl get pods -n "$NS"
